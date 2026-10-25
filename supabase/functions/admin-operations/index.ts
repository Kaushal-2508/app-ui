import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * The caller's token could not be resolved to a LIVE GoTrue session. Must map
 * to HTTP 401, never the generic 400: `invokeEdgeFunction` reads 401 as "refresh
 * the token and retry, and sign out if the refresh fails", whereas a 400 is
 * taken as the action itself failing and surfaces a dead-end "Unauthorized".
 */
class AuthFailure extends Error {
  readonly status = 401;
}

/** What public.diagnose_user_delete returns (migration 20260925130000). */
interface DeleteDiagnosis {
  ok: boolean;
  sqlstate?: string;
  message?: string;
  constraint?: string | null;
  table?: string | null;
  context?: string;
}

/**
 * GoTrue reports every database failure inside auth.admin.deleteUser as
 * "Database error deleting user", which is all admins saw on the three
 * occasions user delete broke (2026-04-22, 09-11, 09-25). Call this ONLY after
 * a delete has failed: diagnose_user_delete re-runs the delete in an
 * always-rolled-back subtransaction and returns the real Postgres error. The
 * cause is logged here, and the returned message is one an admin can act on
 * (short and non-technical, so toastError shows it as is). Never throws.
 */
async function explainDeleteFailure(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ userMessage: string; diagnosis: DeleteDiagnosis | null }> {
  let diagnosis: DeleteDiagnosis | null = null;
  try {
    const { data, error } = await adminClient.rpc("diagnose_user_delete", { _user_id: userId });
    if (error) {
      console.error(`diagnose_user_delete failed for ${userId}:`, error.message);
    } else {
      diagnosis = data as DeleteDiagnosis;
    }
  } catch (err) {
    console.error(`diagnose_user_delete threw for ${userId}:`, err);
  }
  console.error(`User delete blocked for ${userId}:`, JSON.stringify(diagnosis));

  let userMessage =
    "This account is linked to records that stop it being deleted. Please report it through Salci Support.";
  if (diagnosis?.ok) {
    // The database would accept the delete now, so the failure was transient.
    userMessage = "Couldn't delete this account just now. Please try again in a minute.";
  } else if (diagnosis?.constraint === "support_settings_owner_id_fkey") {
    userMessage =
      "This person owns the Salci Support settings. Hand support ownership to someone else first, then delete the account.";
  } else if (diagnosis?.message === "user not found in auth.users") {
    userMessage =
      "This account's sign-in was already removed. Refresh the page, and report it through Salci Support if it still shows.";
  }
  return { userMessage, diagnosis };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deletes an auth user the same way as before (GoTrue deleteUser: 120 s budget,
 * auth audit event), after first recording WHO is deleting in dua.delete_intents,
 * so the Deleted Users archive can name them (spec 2026-10-06-deleted-users-page-design).
 * The database trigger copies everything before the cascade and uses the intent up.
 * If the delete fails, the intent is cancelled so it can never attribute a later
 * delete made another way. A failure to record the intent never blocks the delete.
 */
async function deleteAuthUserNoted(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  actorId: string,
  source: string,
): Promise<{ error: { message: string } | null }> {
  const { error: noteError } = await adminClient.rpc("dua_note_delete", {
    _user_ids: [userId],
    _actor_id: UUID_RE.test(actorId) ? actorId : null,
    _source: source,
    _on_request: false,
  });
  if (noteError) console.error("dua_note_delete failed, archive will show no app actor:", noteError.message);

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    const { error: cancelError } = await adminClient.rpc("dua_cancel_delete_intent", { _user_id: userId });
    if (cancelError) console.error("dua_cancel_delete_intent failed:", cancelError.message);
    return { error: { message: error.message } };
  }
  return { error: null };
}

interface CreateInstitutionRequest {
  action: "create_institution";
  data: {
    name: string;
    code: string;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    adminEmail: string;
    adminName: string;
    adminPassword?: string;
    // Extended wizard data - per-class subjects
    academicYear?: string;
    classes?: Array<{
      name: string;
      sections: string[];
      subjectIds: string[];
    }>;
  };
}

interface CreateUserRequest {
  action: "create_user";
  data: {
    email: string;
    fullName: string;
    password?: string;
    role: "school_admin" | "coordinator" | "teacher" | "student";
    institutionId: string;
    // Student-specific fields for admission number login
    phone?: string;
    admissionNumber?: string;
    rollNumber?: string;
    // Class assignment for students
    classId?: string;
    // When true, suppress the Resend welcome mail. Used when `email` is a
    // synthesised @temp.local placeholder for a student without an inbox.
    skipWelcomeEmail?: boolean;
  };
}

interface UpdateAIConfigRequest {
  action: "update_ai_config";
  data: {
    configKey: string;
    configValue: string;
    isEnabled: boolean;
  };
}

interface UpdateQuotaRequest {
  action: "update_quota";
  data: {
    institutionId: string;
    dailyQuestionLimit?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
    questionGenerationEnabled?: boolean;
    ocrEnabled?: boolean;
  };
}

interface DeleteInstitutionRequest {
  action: "delete_institution";
  data: {
    institutionId: string;
  };
}

interface DeleteUserRequest {
  action: "delete_user";
  data: {
    userId: string;
  };
}

interface ResetUserPasswordRequest {
  action: "reset_user_password";
  data: {
    userId: string;
    newPassword: string;
  };
}

interface UpdateUserRequest {
  action: "update_user";
  data: {
    userId: string;
    updates: {
      email?: string;
      password?: string;
    };
  };
}

interface BulkUpdateStudentProfilesRequest {
  action: "bulk_update_student_profiles";
  data: {
    institutionId: string;
    students: Array<{
      email: string;
      admissionNumber?: string;
      phone?: string;
      rollNumber?: string;
    }>;
  };
}

interface BulkDeleteStudentsRequest {
  action: "bulk_delete_students";
  data: {
    institutionId: string;
    batchSize?: number;
  };
}

interface GetLastSignInRequest {
  action: "get_last_sign_in";
  data: {
    userIds: string[];
  };
}

/**
 * Admissions (migration 20261012120000): the auth user, then admission_admit_tx
 * for the profile, role, section, personal details and the enquiry's stage in
 * one transaction. School admins and the school's named admissions staff.
 */
interface AdmitStudentRequest {
  action: "admit_student";
  data: {
    enquiryId: string;
    institutionId: string;
    fullName: string;
    dateOfBirth: string;
    gender: string;
    guardianName: string;
    guardianPhone: string;
    guardianEmail?: string | null;
    classId: string;
    admissionNumber?: string | null;
    admissionNumberIsAuto?: boolean;
    admittedOn?: string | null;
    previousSchool?: string | null;
    form?: Record<string, unknown> | null;
    documents?: Array<{ doc_key: string; collected: boolean }>;
  };
}

type AdminRequest =
  | CreateInstitutionRequest
  | CreateUserRequest
  | UpdateAIConfigRequest
  | UpdateQuotaRequest
  | DeleteInstitutionRequest
  | DeleteUserRequest
  | ResetUserPasswordRequest
  | UpdateUserRequest
  | BulkUpdateStudentProfilesRequest
  | BulkDeleteStudentsRequest
  | GetLastSignInRequest
  | AdmitStudentRequest;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // CRITICAL: Verify environment variables exist
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error("FATAL: Missing environment variables", {
        hasUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey,
        hasAnonKey: !!supabaseAnonKey,
      });
      throw new Error("Server configuration error. Please contact administrator.");
    }
    
    console.log("Environment verification passed");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new AuthFailure("Missing authorization header");
    }
    
    // Check if this is a service-role call (internal/tooling)
    const token = authHeader.replace("Bearer ", "");
    const isServiceRoleCall = token === supabaseServiceKey;
    
    let user: any;
    let supabaseClient: any;
    
    if (isServiceRoleCall) {
      // Service-role calls are trusted — used by internal tooling only
      console.log("Service-role authenticated call");
      user = { id: "service-role" };
      supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    } else {
      // Client for auth check (uses anon key with user's auth header)
      supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      // Get authenticated user. The token is passed explicitly so this does not
      // depend on how the (unpinned) supabase-js build treats a custom
      // Authorization header.
      const { data: { user: authUser }, error: userError } = await supabaseClient.auth.getUser(token);
      if (userError || !authUser) {
        // Keep GoTrue's reason in the logs. `session_not_found` means the JWT is
        // still cryptographically valid but its session row is gone (a global
        // sign-out from another device, a password reset, an admin revoke).
        // PostgREST keeps honouring such a token, so the page still looks
        // signed in while every edge function rejects it (2026-09-11: a
        // super_school_admin got a bare "Unauthorized" on every teacher delete).
        console.error(
          "Auth check failed:",
          userError?.status ?? "",
          userError?.code ?? userError?.message ?? "no user",
        );
        throw new AuthFailure("Your session is no longer valid. Please sign in again.");
      }
      user = authUser;
    }

    // Fetch user roles WITH institution_id
    let isSuperAdmin = isServiceRoleCall; // Service-role calls get super_admin privileges
    let isSchoolAdmin = false;
    let isCoordinator = false;
    let isTeacher = false;
    // Per-user "manage teaching staff" grant (staff_manager_overrides) — a
    // named non-admin allowed to create/delete TEACHER accounts only. See
    // migration 20260714120000. Never true for anyone without a grant row.
    let isStaffManager = false;
    // Per-user "manage students" grant (student_manager_overrides) — a named
    // non-admin allowed to create/delete STUDENT accounts only. See migration
    // 20260728120000. Never true for anyone without a grant row.
    let isStudentManager = false;
    let userInstitutionId: string | null = null;

    if (!isServiceRoleCall) {
      const { data: roles } = await supabaseClient
        .from("user_roles")
        .select("role, institution_id")
        .eq("user_id", user.id);

      isSuperAdmin = roles?.some(r => r.role === "super_admin") || false;
      isSchoolAdmin = roles?.some(r => r.role === "school_admin" || r.role === "super_school_admin") || false;
      isCoordinator = roles?.some(r => r.role === "coordinator") || false;
      isTeacher = roles?.some(r => r.role === "teacher") || false;
      userInstitutionId = roles?.find(r => r.institution_id)?.institution_id || null;

      // Service-role read: the grant table is self-read-only under RLS, and
      // the institution must still match the caller's own institution.
      const adminLookup = createClient(supabaseUrl, supabaseServiceKey);
      const [staffOverride, studentOverride] = await Promise.all([
        adminLookup
          .from("staff_manager_overrides")
          .select("institution_id")
          .eq("user_id", user.id)
          .maybeSingle(),
        adminLookup
          .from("student_manager_overrides")
          .select("institution_id")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      isStaffManager =
        !!staffOverride.data &&
        !!userInstitutionId &&
        staffOverride.data.institution_id === userInstitutionId;
      isStudentManager =
        !!studentOverride.data &&
        !!userInstitutionId &&
        studentOverride.data.institution_id === userInstitutionId;
    }

    // Service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const body: AdminRequest = await req.json();
    console.log("Admin operation:", body.action, "by user:", user.id);

    // Accounts barred from deleting users whatever their role (public.user_delete_blocked,
    // first used for admin@salci.in, handed to a tester on 2026-10-07). Fails closed: if
    // the list cannot be read, no delete goes ahead.
    if (body.action === "delete_user" || body.action === "bulk_delete_students" || body.action === "delete_institution") {
      const { data: blocked, error: blockedError } = await adminClient
        .from("user_delete_blocked")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (blockedError) {
        console.error("user_delete_blocked lookup failed:", blockedError.message);
        throw new Error("Couldn't check delete permission. Please try again.");
      }
      if (blocked) {
        console.warn("Delete refused, actor is on user_delete_blocked:", user.id);
        throw new Error("This account isn't allowed to delete users.");
      }
    }

    // Define role hierarchy for user creation
    // NOTE: school_admin can create peer school_admins (flat hierarchy within institution)
    const canCreateRoles: Record<string, string[]> = {
      super_admin: ["school_admin", "coordinator", "teacher", "student"],
      school_admin: ["school_admin", "coordinator", "teacher", "student"], // Peer admin creation allowed
      coordinator: ["teacher", "student"],
      teacher: ["student"],
    };

    // Action-specific authorization
    switch (body.action) {
      case "create_institution":
      case "update_ai_config":
      case "update_quota":
      case "delete_institution":
        // Super admin only
        if (!isSuperAdmin) {
          throw new Error("Only super admins can perform this action");
        }
        break;

      case "bulk_delete_students":
        // Super admin only
        if (!isSuperAdmin) {
          throw new Error("Only super admins can perform this action");
        }
        break;

      case "delete_user": {
        const requestData = (body as DeleteUserRequest).data;

        // Get target user's roles and institution
        const { data: targetUserRoles } = await adminClient
          .from("user_roles")
          .select("role, institution_id")
          .eq("user_id", requestData.userId);

        const targetInstitution = targetUserRoles?.find(r => r.institution_id)?.institution_id;
        const targetIsSuperAdmin = targetUserRoles?.some(r => r.role === "super_admin");
        const targetIsSchoolAdmin = targetUserRoles?.some(
          r => r.role === "school_admin" || r.role === "super_school_admin"
        );
        const targetIsCoordinator = targetUserRoles?.some(r => r.role === "coordinator");
        const targetIsTeacher = targetUserRoles?.some(r => r.role === "teacher");

        // Cannot delete super admins
        if (targetIsSuperAdmin) {
          throw new Error("Cannot delete super admin users");
        }

        // Super admins can delete anyone (except other super admins)
        if (isSuperAdmin) {
          break;
        }

        // School admins can delete users in their institution
        if (isSchoolAdmin && targetInstitution === userInstitutionId) {
          break;
        }

        // Coordinators can delete teachers in their institution, and students
        // only in their OWN wing's classes. They cannot delete school_admins or
        // fellow coordinators — promoting or removing a coordinator is still an
        // admin-only action.
        if (
          isCoordinator &&
          targetInstitution === userInstitutionId &&
          !targetIsSchoolAdmin &&
          !targetIsCoordinator
        ) {
          const targetIsStudent = targetUserRoles?.some(r => r.role === "student");
          if (!targetIsStudent) {
            break;
          }
          // Wing scope (2026-10-05, when the Students page gave coordinators a
          // delete button): before this a coordinator could delete ANY student
          // in the school through this endpoint, although the page only lists
          // their wing. can_manage_student_subjects is the canonical "admins +
          // wing-coordinators" test (coordinator role, same school, student in
          // a class mapped to the caller's wing); a student-manager grant also
          // passes it, matching that branch below. Not in scope: fall through
          // to the remaining branches and the final permission error.
          const { data: inScope, error: scopeError } = await adminClient.rpc(
            "can_manage_student_subjects",
            { _actor: user.id, _student: requestData.userId },
          );
          if (scopeError) {
            console.error("can_manage_student_subjects failed:", scopeError.message);
            throw new Error("Couldn't check your access to this student. Please try again.");
          }
          if (inScope === true) {
            break;
          }
        }

        // Staff-manager override holders can delete TEACHERS in their own
        // institution — nothing else. Stricter than the coordinator branch
        // above: the target must actually hold the teacher role (so students
        // are out of reach too), and must not be an admin or coordinator.
        if (
          isStaffManager &&
          targetInstitution === userInstitutionId &&
          targetIsTeacher &&
          !targetIsSchoolAdmin &&
          !targetIsCoordinator
        ) {
          break;
        }

        // Student-manager override holders can delete STUDENTS in their own
        // institution — nothing else. The target must actually hold the
        // student role and must not hold any staff role, so a teacher,
        // coordinator or admin can never be removed through this grant.
        if (
          isStudentManager &&
          targetInstitution === userInstitutionId &&
          targetUserRoles?.some(r => r.role === "student") &&
          !targetIsSchoolAdmin &&
          !targetIsCoordinator &&
          !targetIsTeacher
        ) {
          break;
        }

        throw new Error("You do not have permission to delete this user");
      }

      case "create_user": {
        const requestData = (body as CreateUserRequest).data;
        const targetRole = requestData.role;
        const targetInstitution = requestData.institutionId;

        // Determine caller's highest role and permissions
        let callerRole = "";
        let allowedRoles: string[] = [];

        if (isSuperAdmin) {
          callerRole = "super_admin";
          allowedRoles = canCreateRoles.super_admin;
        } else if (isSchoolAdmin) {
          callerRole = "school_admin";
          allowedRoles = canCreateRoles.school_admin;
        } else if (isCoordinator) {
          callerRole = "coordinator";
          allowedRoles = canCreateRoles.coordinator;
        } else if (isTeacher) {
          callerRole = "teacher";
          allowedRoles = canCreateRoles.teacher;
        } else if (isStaffManager || isStudentManager) {
          // Grant holder with no other creating role still gets in; the
          // per-grant additions below fill in what they may create.
          callerRole = "override_grant";
          allowedRoles = [];
        } else {
          throw new Error("You do not have permission to create users");
        }

        // Each override adds exactly ONE role on top of whatever the
        // caller's own role already allows. Neither ever widens to
        // coordinator or admin creation.
        if (isStaffManager && !allowedRoles.includes("teacher")) {
          allowedRoles = [...allowedRoles, "teacher"];
          callerRole = `${callerRole} + staff_manager`;
        }
        if (isStudentManager && !allowedRoles.includes("student")) {
          allowedRoles = [...allowedRoles, "student"];
          callerRole = `${callerRole} + student_manager`;
        }

        // Check if caller can create the target role
        if (!allowedRoles.includes(targetRole)) {
          throw new Error(`Your role (${callerRole}) cannot create users with role: ${targetRole}`);
        }

        // Non-super-admins must create users in their own institution only
        if (!isSuperAdmin && targetInstitution !== userInstitutionId) {
          throw new Error("You can only add users to your own institution");
        }

        console.log(`User ${callerRole} creating ${targetRole} in institution ${targetInstitution}`);
        break;
      }

      case "admit_student": {
        // School admins and the school's named admissions staff
        // (admissions_overrides), asked through _admissions_can.
        const requestData = (body as AdmitStudentRequest).data;
        if (
          !requestData ||
          !UUID_RE.test(requestData.enquiryId ?? "") ||
          !UUID_RE.test(requestData.institutionId ?? "") ||
          !UUID_RE.test(requestData.classId ?? "")
        ) {
          throw new Error("That admission is missing the enquiry or the section.");
        }
        if (!UUID_RE.test(user.id)) {
          throw new Error("An admission must be made by a signed-in person.");
        }
        if (!isSuperAdmin && requestData.institutionId !== userInstitutionId) {
          throw new Error("You can only admit students to your own institution");
        }
        const { data: canAdmit, error: canError } = await adminClient.rpc("_admissions_can", {
          _uid: user.id,
          _inst: requestData.institutionId,
        });
        if (canError) {
          console.error("_admissions_can failed:", canError.message);
          throw new Error("Couldn't check your access to admissions. Please try again.");
        }
        if (canAdmit !== true) {
          throw new Error("Only admissions staff can admit a student.");
        }
        break;
      }
    }

    let result: any;

    switch (body.action) {
      case "create_institution": {
        const { data } = body as CreateInstitutionRequest;
        
        // Sanitize email inputs - trim whitespace
        const adminEmail = data.adminEmail?.trim();
        const contactEmail = data.contactEmail?.trim();
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!adminEmail || !emailRegex.test(adminEmail)) {
          throw new Error(`Invalid admin email format: "${data.adminEmail}". Please provide a valid email address.`);
        }
        
        // VALIDATE: Check institution code uniqueness first
        const { data: existingInst } = await adminClient
          .from("institutions")
          .select("id")
          .eq("code", data.code.toUpperCase())
          .single();
        
        if (existingInst) {
          throw new Error(`Institution code "${data.code.toUpperCase()}" already exists. Please use a different code.`);
        }
        
        // VALIDATE: Check admin email uniqueness
        const { data: existingAuth } = await adminClient.auth.admin.listUsers();
        const emailExists = existingAuth?.users?.some(u => u.email?.toLowerCase() === adminEmail.toLowerCase());
        if (emailExists) {
          throw new Error(`A user with email "${adminEmail}" already exists. Please use a different email.`);
        }
        
        console.log("Validation passed, creating institution:", data.code.toUpperCase());
        
        // Create institution
        const { data: institution, error: instError } = await adminClient
          .from("institutions")
          .insert({
            name: data.name,
            code: data.code.toUpperCase(),
            contact_email: contactEmail || null,
            contact_phone: data.contactPhone,
            address: data.address,
            is_active: true,
          })
          .select()
          .single();

        if (instError) {
          console.error("Institution creation error:", instError);
          if (instError.message.includes("unique") || instError.message.includes("duplicate")) {
            throw new Error(`Institution code "${data.code.toUpperCase()}" already exists.`);
          }
          throw new Error(`Failed to create institution: ${instError.message}`);
        }
        
        console.log("Institution created:", institution.id);

        // Use provided password or generate one
        const adminPassword = data.adminPassword || generatePassword();
        console.log("Using client-provided password:", !!data.adminPassword);

        // Create admin user in auth
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email: adminEmail,
          password: adminPassword,
          email_confirm: true,
          user_metadata: { full_name: typeof data.adminName === "string" ? data.adminName.trim() : String(data.adminName ?? "").trim() },
        });

        if (authError) {
          console.error("Auth user creation error:", authError);
          // Rollback institution
          await adminClient.from("institutions").delete().eq("id", institution.id);
          throw new Error(`Failed to create admin user: ${authError.message}`);
        }

        // Profile is auto-created by trigger, update institution_id
        await adminClient
          .from("profiles")
          .update({ institution_id: institution.id })
          .eq("id", authUser.user.id);

        // Assign admin role (use provided role or default to school_admin)
        const adminRole = (data as any).adminRole || "school_admin";
        await adminClient.from("user_roles").insert({
          user_id: authUser.user.id,
          role: adminRole,
          institution_id: institution.id,
          granted_by: user.id,
        });

        // Create subscription record
        await adminClient.from("institution_subscriptions").insert({
          institution_id: institution.id,
          plan_name: "basic",
          plan_type: "monthly",
          monthly_amount: 0,
          status: "active",
          billing_cycle_start: new Date().toISOString().split('T')[0],
          next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        });

        // Create AI quota
        await adminClient.from("ai_usage_quotas").insert({
          institution_id: institution.id,
          daily_question_limit: 50,
          daily_token_limit: 100000,
          monthly_token_limit: 2000000,
        });

        // ── Class structure ────────────────────────────────────────────
        // CLAUDE.md §22 / class-groups skill: the canonical write path is
        //   class_groups  →  classes(class_group_id)  →  subject_class_group_mappings
        // and the SECURITY DEFINER fanout trigger materialises the legacy
        // subject_class_mappings rows. NEVER write subject_class_mappings from
        // here: the old code did, which left the group catalog EMPTY, so a
        // section added later inherited nothing (inherit_subjects_for_new_section
        // reads the group table).
        //
        // BATCHING CHOICE (deliberate): every section row carries an explicit
        // class_group_id, which makes auto_attach_class_to_group() hit its
        // "IF NEW.class_group_id IS NOT NULL THEN RETURN NEW" early exit. There
        // is therefore no per-row group lookup to race, so a single multi-row
        // INSERT into classes is safe without relying on plpgsql snapshot
        // semantics inside one statement. This mirrors the canonical in-app
        // path (src/hooks/useClassGroups.ts useCreateClassGroup). If that
        // trigger ever gains extra responsibilities, this call site skips them
        // and must be kept in sync.
        // String(...) not .trim() directly: this endpoint is reachable outside
        // the wizard, and a JSON number (academicYear: 2026) would make .trim()
        // a TypeError. Throwing here would strand the institution, auth user,
        // role, subscription and quota that are already committed above, and the
        // retry would then fail on the code-uniqueness check.
        const rawYear = data.academicYear;
        const academicYear =
          (rawYear === undefined || rawYear === null || String(rawYear).trim() === "")
            ? new Date().getFullYear().toString()
            : String(rawYear).trim();

        // Non-fatal problems. By this point the institution, auth user, role and
        // subscription already exist, so a throw here would strand half-created
        // state and report total failure for a mostly-successful create. Every
        // failure below is logged, counted, surfaced in the result and written to
        // the audit row instead. Warning text stays plain English (§19) - the raw
        // Postgres error only ever goes to console.error.
        const setupWarnings: string[] = [];
        const MAX_WARNINGS = 25;
        let suppressedWarnings = 0;
        const addWarning = (message: string) => {
          if (setupWarnings.length < MAX_WARNINGS) setupWarnings.push(message);
          else suppressedWarnings += 1;
        };

        let classGroupsCreated = 0;
        let sectionsCreated = 0;
        let subjectMappingsCreated = 0;

        // Batched insert that degrades to one row at a time ONLY on failure, so a
        // single bad row (duplicate id, subject deleted between wizard load and
        // submit) cannot silently void every sibling row - the exact failure mode
        // of the previous implementation.
        // A failed batch means EITHER the statement was rejected OR we never
        // learned its outcome (pooler reset, gateway 502, aborted fetch). From
        // here those are indistinguishable, and re-reading to tell them apart
        // does NOT work: the read can run while the commit is still in flight
        // and return a pre-commit snapshot, which reads as "nothing landed".
        //
        // So a row-by-row retry is safe ONLY where the database itself can
        // reject the duplicate. That is true for subject_class_group_mappings
        // (uq_scgm_institution_group_subject) and FALSE for `classes`, which has
        // no natural unique key: retrying a batch that actually committed would
        // give the school two identical "Class 10 A" rows under one
        // class_group_id, each collecting its own fanout mappings, with nothing
        // in the schema to catch it and no safe automatic cleanup.
        //
        // `retrySafe` therefore gates the retry, and `classes` opts out: one
        // batch, and on failure we report precisely rather than guess. A
        // reported partial create that an admin can finish in the portal beats
        // a silently duplicated class structure.
        const insertResilient = async (
          table: string,
          rows: Record<string, unknown>[],
          describe: (row: Record<string, unknown>) => string,
          retrySafe: boolean,
        ): Promise<number> => {
          const CHUNK = 250;
          let written = 0;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const { error: chunkError } = await adminClient.from(table).insert(chunk);
            if (!chunkError) {
              written += chunk.length;
              continue;
            }

            if (!retrySafe) {
              console.error(`create_institution: batched insert into ${table} failed, NOT retrying (no unique key to make a retry idempotent)`, chunkError);
              addWarning(`${chunk.length} of the ${rows.length} class sections could not be confirmed as saved. Open this school's Classes page and check the list before use.`);
              continue;
            }

            console.error(`create_institution: batched insert into ${table} failed, retrying row by row`, chunkError);
            for (const row of chunk) {
              const { error: rowError } = await adminClient.from(table).insert(row);
              if (!rowError) {
                written += 1;
                continue;
              }
              // 23505 on retry means the batch DID commit this row and we simply
              // lost the response. Counting it as written keeps the result and
              // the audit row from contradicting the database, and suppresses a
              // warning that would otherwise be flatly wrong.
              if ((rowError as { code?: string }).code === "23505") {
                written += 1;
                continue;
              }
              console.error(`create_institution: ${table} row failed [${describe(row)}]`, rowError);
              addWarning(`${describe(row)} could not be saved.`);
            }
          }
          return written;
        };

        // 1. Normalise wizard input. Merge duplicate class names (grade_levels has
        //    two rows literally named "UKG", so the picker can emit the name
        //    twice), trim + dedupe sections (classes has no natural UNIQUE key)
        //    and dedupe subject ids (a repeat would violate
        //    uq_scgm_institution_group_subject and, under the old code, void the
        //    whole batch).
        interface ClassEntry { name: string; sections: string[]; subjectIds: string[] }
        const classEntries: ClassEntry[] = [];
        const entryByName = new Map<string, ClassEntry>();
        // Same String(...) coercion rationale as academicYear above: a non-string
        // name from a direct API call must not throw and strand the institution.
        const asTrimmed = (v: unknown): string =>
          v === undefined || v === null ? "" : String(v).trim();
        if (data.classes !== undefined && data.classes !== null && !Array.isArray(data.classes)) {
          addWarning("The class list was not in the expected format, so no classes were created.");
        }
        for (const raw of (Array.isArray(data.classes) ? data.classes : [])) {
          const entryName = asTrimmed(raw?.name);
          if (!entryName) {
            addWarning("A class with a blank name was skipped.");
            continue;
          }
          const entryKey = entryName.toLowerCase();
          let entry = entryByName.get(entryKey);
          if (!entry) {
            entry = { name: entryName, sections: [], subjectIds: [] };
            entryByName.set(entryKey, entry);
            classEntries.push(entry);
          }
          for (const rawSection of (Array.isArray(raw.sections) ? raw.sections : [])) {
            const section = asTrimmed(rawSection);
            if (section && !entry.sections.includes(section)) entry.sections.push(section);
          }
          for (const subjectId of (Array.isArray(raw.subjectIds) ? raw.subjectIds : [])) {
            if (subjectId && !entry.subjectIds.includes(subjectId)) entry.subjectIds.push(subjectId);
          }
        }

        // 2. Resolve grade_level_id by EXACT grade_name match. The wizard's class
        //    names are grade_levels.grade_name verbatim, so this is both correct
        //    and immune to the two defects in auto_attach_class_to_group()'s
        //    digit regex: pre-primary names carry no digit (Pre Nursery / Nursery
        //    / LKG / UKG all resolve to NULL) and stream rows carry sequence
        //    numbers, not grades ("Class 11 Humanities" -> 11 -> "Class 11 Science
        //    - Medical"). grade_levels is GLOBAL - never filter it by institution.
        interface GradeLevelRow { id: string; grade_name: string | null; grade_number: number | null }
        const gradeLevelIdByName = new Map<string, string>();
        if (classEntries.length > 0) {
          const { data: gradeLevelRows, error: gradeLevelError } = await adminClient
            .from("grade_levels")
            .select("id, grade_name, grade_number")
            .order("display_order", { ascending: true })
            .range(0, 499);

          if (gradeLevelError) {
            console.error("create_institution: grade_levels lookup failed", gradeLevelError);
            addWarning("Grade levels could not be read, so classes were created without a grade link.");
          } else {
            const grades = (gradeLevelRows ?? []) as GradeLevelRow[];
            const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
            // Mirrors LOWER_GRADE_NUMBER_BY_NAME in src/hooks/useClassGroups.ts.
            const lowerGradeNumbers: Record<string, number | undefined> = {
              prenursery: -4,
              nursery: -3,
              lkg: -2,
              ukg: -1,
            };

            for (const entry of classEntries) {
              const key = normalise(entry.name);
              const exact = grades.filter((g) => normalise(g.grade_name ?? "") === key);
              let resolved: GradeLevelRow | undefined = exact[0];

              if (exact.length > 1) {
                // Duplicate grade_name (prod has UKG at grade_number -1 canonical
                // and 0 stray). Pick the canonical grade_number for the name.
                const digits = entry.name.match(/\d+/);
                const wanted = digits ? parseInt(digits[0], 10) : lowerGradeNumbers[key];
                resolved = exact.find((g) => g.grade_number === wanted) ?? exact[0];
              }

              if (!resolved) {
                // Section-stripped head match, mirroring rule 2b of
                // public.resolve_grade_level_id_for_class_name (migration
                // 20260902120000). Without this, "Class 11 Humanities - A" falls
                // through to the digit fallback, which rejects every grade_number
                // 11 candidate and leaves grade_level_id NULL, while the SQL
                // resolver used by auto_attach_class_to_group resolves it fine.
                // Two write paths disagreeing on the same input is how a class
                // ends up with no grade link, which is the documented cause of
                // the "bulk upload: no grade linked" failure.
                const head = entry.name.split(/\s+[-–—]\s+/)[0].trim();
                if (head && head !== entry.name) {
                  const headKey = normalise(head);
                  const headMatches = grades.filter((g) => normalise(g.grade_name ?? "") === headKey);
                  if (headMatches.length > 1) {
                    const headDigits = head.match(/\d+/);
                    const headWanted = headDigits
                      ? parseInt(headDigits[0], 10)
                      : lowerGradeNumbers[headKey];
                    resolved = headMatches.find((g) => g.grade_number === headWanted) ?? headMatches[0];
                  } else {
                    resolved = headMatches[0];
                  }
                }
              }

              if (!resolved) {
                // No exact name match (custom class name). Fall back to the number,
                // but only accept a candidate whose own name is contained in - or
                // contains - the class name, so "Class 11 Blue" can never silently
                // land on "Class 11 Science - Medical".
                const digits = entry.name.match(/\d+/);
                const wanted = digits ? parseInt(digits[0], 10) : lowerGradeNumbers[key];
                if (wanted !== undefined) {
                  const byNumber = grades.filter((g) => g.grade_number === wanted);
                  resolved = byNumber.find((g) => {
                    const candidate = normalise(g.grade_name ?? "");
                    return candidate.length > 0 && (key.includes(candidate) || candidate.includes(key));
                  });
                }
              }

              if (resolved) {
                gradeLevelIdByName.set(entry.name, resolved.id);
              } else {
                addWarning(`No grade level matched "${entry.name}", so its syllabus and question bank will need the grade linked manually.`);
              }
            }
          }
        }

        // 3. One class_groups row per class entry, in one statement. Creating the
        //    group up front and passing class_group_id explicitly on every section
        //    below makes auto_attach_class_to_group() a no-op, so the multi-row
        //    classes INSERT never depends on one row's group being visible to the
        //    next row's lookup inside the same statement.
        const groupIdByName = new Map<string, string>();
        if (classEntries.length > 0) {
          const groupRows = classEntries.map((entry) => ({
            institution_id: institution.id,
            name: entry.name,
            academic_year: academicYear,
            grade_level_id: gradeLevelIdByName.get(entry.name) ?? null,
            is_active: true,
          }));

          const { data: insertedGroups, error: groupsError } = await adminClient
            .from("class_groups")
            .insert(groupRows)
            .select("id, name");

          if (!groupsError) {
            for (const group of (insertedGroups ?? []) as Array<{ id: string; name: string }>) {
              groupIdByName.set(group.name, group.id);
            }
            classGroupsCreated = groupIdByName.size;
          } else {
            // Degrade to one statement per class so a single bad row cannot cost
            // the entire class structure.
            console.error("create_institution: batched class_groups insert failed, retrying per class", groupsError);
            for (const row of groupRows) {
              const { data: oneGroup, error: oneError } = await adminClient
                .from("class_groups")
                .insert(row)
                .select("id")
                .single();

              if (!oneError && oneGroup) {
                groupIdByName.set(row.name, (oneGroup as { id: string }).id);
                classGroupsCreated += 1;
                continue;
              }

              // uq_class_groups_institution_name_year may already hold the row.
              const { data: existingGroup } = await adminClient
                .from("class_groups")
                .select("id")
                .eq("institution_id", institution.id)
                .eq("name", row.name)
                .eq("academic_year", academicYear)
                .maybeSingle();

              if (existingGroup) {
                groupIdByName.set(row.name, (existingGroup as { id: string }).id);
                // Count it: the batch DID commit and we simply lost the response.
                // Without this the audit row reports 0 class groups created while
                // the rows plainly exist, and the record contradicts the database.
                classGroupsCreated += 1;
                continue;
              }

              console.error(`create_institution: class_groups insert failed for "${row.name}"`, oneError);
              addWarning(`Class "${row.name}" could not be created, so its sections and subjects were skipped.`);
            }
          }
        }

        // 4. Every section of every class in one statement, each row carrying its
        //    explicit class_group_id. A class whose group is missing is skipped
        //    whole - no orphan sections, and never a fallback write to the legacy
        //    subject_class_mappings table.
        const sectionRows: Record<string, unknown>[] = [];
        for (const entry of classEntries) {
          const groupId = groupIdByName.get(entry.name);
          if (!groupId) continue;
          if (entry.sections.length === 0) {
            addWarning(`Class "${entry.name}" was created with no sections.`);
            continue;
          }
          for (const section of entry.sections) {
            sectionRows.push({
              institution_id: institution.id,
              class_group_id: groupId,
              name: entry.name,
              section,
              academic_year: academicYear,
              is_active: true,
            });
          }
        }
        if (sectionRows.length > 0) {
          // retrySafe:false, see insertResilient. `classes` has no unique key,
          // so a retry cannot be made idempotent and must not be attempted.
          sectionsCreated = await insertResilient(
            "classes",
            sectionRows,
            (row) => `Section ${String(row.name)} ${String(row.section)}`,
            false,
          );
        }
        console.log(
          `create_institution: ${classGroupsCreated} class group(s), ${sectionsCreated}/${sectionRows.length} section(s)`,
        );

        // 5. Group-level subject catalog LAST: the AFTER INSERT fanout trigger
        //    materialises one subject_class_mappings row per section that already
        //    exists, so every section must be in place first. Deduped on
        //    (class_group_id, subject_id) for uq_scgm_institution_group_subject.
        const mappingRows: Record<string, unknown>[] = [];
        const seenMappings = new Set<string>();
        // Keyed the same way the describe() callback keys a row, so a failure
        // names the class instead of an internal uuid (section 19: no raw ids in
        // user-facing copy, and these strings also land in the audit row).
        const mappingLabels = new Map<string, string>();
        for (const entry of classEntries) {
          const groupId = groupIdByName.get(entry.name);
          if (!groupId) continue;
          if (entry.subjectIds.length === 0) {
            addWarning(`Class "${entry.name}" was created with no subjects. Add them from Classes and Subjects.`);
            continue;
          }
          for (const subjectId of entry.subjectIds) {
            const mappingKey = `${groupId}|${subjectId}`;
            if (seenMappings.has(mappingKey)) continue;
            seenMappings.add(mappingKey);
            mappingLabels.set(mappingKey, `One subject for class "${entry.name}"`);
            mappingRows.push({
              institution_id: institution.id,
              class_group_id: groupId,
              subject_id: subjectId,
            });
          }
        }
        if (mappingRows.length > 0) {
          subjectMappingsCreated = await insertResilient(
            "subject_class_group_mappings",
            mappingRows,
            (row) =>
              mappingLabels.get(`${String(row.class_group_id)}|${String(row.subject_id)}`)
                ?? "One class subject",
            true,   // uq_scgm_institution_group_subject makes a row retry idempotent
          );
        }
        console.log(
          `create_institution: ${subjectMappingsCreated}/${mappingRows.length} group subject mapping(s)`,
        );

        if (suppressedWarnings > 0) {
          setupWarnings.push(`${suppressedWarnings} further setup warning(s) were recorded in the function logs.`);
        }

        // Seed institution features
        const enabledFeatures: string[] = (data as any).enabledFeatures || [];
        if (enabledFeatures.length > 0) {
          const featureRows = enabledFeatures.map((featureId: string) => ({
            institution_id: institution.id,
            feature_id: featureId,
            is_enabled: true,
            enabled_by: user.id,
          }));
          const { error: featError } = await adminClient
            .from("institution_features")
            .insert(featureRows);
          if (featError) {
            console.error("Failed to seed features:", featError);
          } else {
            console.log(`Seeded ${featureRows.length} features for institution`);
          }
        }

        // Log audit event
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "institution_created",
          entity_type: "institution",
          entity_id: institution.id,
          entity_name: institution.name,
          new_values: {
            institution,
            admin_email: data.adminEmail,
            classes_created: sectionsCreated,
            class_groups_created: classGroupsCreated,
            subject_group_mappings_created: subjectMappingsCreated,
            setup_warnings: setupWarnings,
          },
          metadata: { institution_id: institution.id },
        });

        // Send welcome email to the new admin
        let emailSent = false;
        let emailError: string | null = null;
        
        try {
          const emailResponse = await fetch(
            `${supabaseUrl}/functions/v1/send-welcome-email`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                users: [{
                  email: adminEmail,
                  name: data.adminName?.trim() || "Administrator",
                  password: adminPassword,
                  role: "school_admin",
                  institutionName: data.name,
                }],
              }),
            }
          );
          
          const emailResult = await emailResponse.json();
          emailSent = emailResult.success;
          if (!emailResult.success) {
            emailError = emailResult.error || "Failed to send welcome email";
          }
          console.log("Admin welcome email result:", emailResult);
        } catch (emailErr) {
          console.error("Error sending admin welcome email:", emailErr);
          emailError = emailErr instanceof Error ? emailErr.message : "Failed to send welcome email";
        }

        const baseMessage = emailSent
          ? "Institution and admin account created successfully. Welcome email sent."
          : "Institution and admin account created successfully (welcome email may have failed)";

        result = {
          institution,
          adminEmail: data.adminEmail,
          adminPassword,
          classesCreated: sectionsCreated,        // unchanged meaning: section rows written
          classGroupsCreated,                     // NEW: class_groups rows written
          subjectMappingsCreated,                 // NEW: subject_class_group_mappings rows written
          setupWarnings,                          // NEW: string[], plain English, [] on a clean run
          emailSent,
          emailError,
          message: setupWarnings.length > 0
            ? `${baseMessage} ${setupWarnings.length} class or subject item(s) need attention.`
            : baseMessage,
        };
        break;
      }

      case "create_user": {
        const { data } = body as CreateUserRequest;
        
        // CRITICAL: Role must be explicitly provided - no defaults
        if (!data.role) {
          throw new Error("Role is required and must be explicitly provided");
        }
        
        // CRITICAL: Institution is required for non-super-admin roles
        if (!data.institutionId) {
          throw new Error("Institution ID is required");
        }
        
        // Validate role is one of allowed values (super_admin CANNOT be created via this endpoint)
        const allowedRoles = ["school_admin", "coordinator", "teacher", "student"];
        if (!allowedRoles.includes(data.role)) {
          throw new Error(`Invalid role: ${data.role}. Must be one of: ${allowedRoles.join(", ")}`);
        }
        
        // VALIDATE: Check email uniqueness
        const { data: existingAuth } = await adminClient.auth.admin.listUsers();
        const emailExists = existingAuth?.users?.some(u => u.email?.toLowerCase() === data.email.toLowerCase());
        if (emailExists) {
          throw new Error(`A user with email "${data.email}" already exists.`);
        }
        
        // VALIDATE: Institution exists
        const { data: inst } = await adminClient
          .from("institutions")
          .select("id")
          .eq("id", data.institutionId)
          .single();
        
        if (!inst) {
          throw new Error("Institution not found. Please select a valid institution.");
        }
        
        console.log("Creating user:", data.email, "with role:", data.role);
        
        // Generate password if not provided
        const password = data.password || generatePassword();

        // Create user in auth
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email: data.email,
          password,
          email_confirm: true,
          user_metadata: { full_name: data.fullName },
        });

        if (authError) {
          console.error("User creation error:", authError);
          if (authError.message.includes("already registered")) {
            throw new Error(`A user with email "${data.email}" already exists.`);
          }
          throw new Error(`Failed to create user: ${authError.message}`);
        }
        
        console.log("Auth user created:", authUser.user.id);

        // Update profile with institution_id AND student-specific fields
        await adminClient
          .from("profiles")
          .update({ 
            institution_id: data.institutionId,
            // Student-specific fields for admission number login
            phone: data.phone || null,
            admission_number: data.admissionNumber || null,
            roll_number: data.rollNumber || null,
          })
          .eq("id", authUser.user.id);

        // Assign role
        await adminClient.from("user_roles").insert({
          user_id: authUser.user.id,
          role: data.role,
          institution_id: data.institutionId,
          granted_by: user.id,
        });

        // If student with classId, assign to class
        if (data.role === "student" && data.classId) {
          const { error: classAssignError } = await adminClient.from("class_assignments").insert({
            user_id: authUser.user.id,
            class_id: data.classId,
            role: "student",
          });
          if (classAssignError) {
            console.error("Class assignment error:", classAssignError);
          } else {
            console.log("Student assigned to class:", data.classId);
          }
        }

        // If teacher, create AI quota
        if (data.role === "teacher") {
          await adminClient.from("teacher_ai_quotas").insert({
            teacher_id: authUser.user.id,
            daily_question_limit: 20,
            daily_token_limit: 50000,
            question_generation_enabled: true,
          });
        }

        // Log audit event
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "user_created",
          entity_type: "user",
          entity_id: authUser.user.id,
          entity_name: data.fullName,
          new_values: { email: data.email, role: data.role },
          metadata: { institution_id: data.institutionId },
        });

        // Send welcome email with credentials — unless the caller explicitly
        // suppressed it (synthetic @temp.local addresses for students without
        // an inbox; see CreateUserRequest.data.skipWelcomeEmail).
        let emailSent = false;
        let emailError: string | null = null;

        if (data.skipWelcomeEmail) {
          console.log("Welcome email suppressed for user", authUser.user.id, "(skipWelcomeEmail=true)");
        } else {
          // Get institution name for the welcome email
          const { data: institutionData } = await adminClient
            .from("institutions")
            .select("name")
            .eq("id", data.institutionId)
            .single();

          try {
            const emailResponse = await fetch(
              `${supabaseUrl}/functions/v1/send-welcome-email`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseAnonKey}`,
                },
                body: JSON.stringify({
                  users: [{
                    email: data.email,
                    name: data.fullName,
                    password: password,
                    role: data.role,
                    institutionName: institutionData?.name || undefined,
                  }],
                }),
              }
            );

            const emailResult = await emailResponse.json();
            emailSent = emailResult.success;
            if (!emailResult.success) {
              emailError = emailResult.error || "Failed to send welcome email";
            }
            console.log("Welcome email result:", emailResult);
          } catch (emailErr) {
            console.error("Error sending welcome email:", emailErr);
            emailError = emailErr instanceof Error ? emailErr.message : "Failed to send welcome email";
          }
        }

        result = {
          userId: authUser.user.id,
          email: data.email,
          password,
          role: data.role,
          emailSent,
          emailError,
          message: data.skipWelcomeEmail
            ? "User created successfully (welcome email skipped — no address provided)"
            : emailSent
              ? "User created successfully and welcome email sent"
              : "User created successfully (welcome email may have failed)",
        };
        break;
      }

      case "delete_institution": {
        const { data } = body as DeleteInstitutionRequest;
        
        console.log("Deleting institution:", data.institutionId);
        
        // Get institution name for audit log
        const { data: institution } = await adminClient
          .from("institutions")
          .select("name, code, is_system")
          .eq("id", data.institutionId)
          .single();
        
        if (!institution) {
          throw new Error("Institution not found");
        }

        // Platform-owned containers (SALCI Support) are not schools. The
        // database trigger guard_system_institution() refuses the delete for
        // every role including this service-role client; this check runs
        // BEFORE the user-deletion loop below so a refused delete never
        // removes accounts first, and so the reason is readable.
        if ((institution as { is_system?: boolean }).is_system) {
          throw new Error(
            `${institution.name} is a system institution and cannot be deleted. Support tickets depend on it.`,
          );
        }
        
        // Get all users from profiles table
        const { data: profileUsers } = await adminClient
          .from("profiles")
          .select("id, email")
          .eq("institution_id", data.institutionId);
        
        // Also get users from user_roles (in case profiles are missing or out of sync)
        const { data: roleUsers } = await adminClient
          .from("user_roles")
          .select("user_id")
          .eq("institution_id", data.institutionId);
        
        // Combine unique user IDs from both sources
        const userIdsFromProfiles = (profileUsers || []).map(p => p.id);
        const userIdsFromRoles = (roleUsers || []).map(r => r.user_id);
        const allUserIds = [...new Set([...userIdsFromProfiles, ...userIdsFromRoles])];
        
        console.log(`Found ${allUserIds.length} users to delete (${userIdsFromProfiles.length} from profiles, ${userIdsFromRoles.length} from roles)`);
        
        // Delete each user from auth.users (this will cascade to profiles and related tables)
        let deletedUsers = 0;
        const failedUsers: string[] = [];
        
        for (const userId of allUserIds) {
          try {
            const { error } = await deleteAuthUserNoted(adminClient, userId, user.id, "app:delete_institution");
            if (!error) {
              deletedUsers++;
              console.log(`Successfully deleted user ${userId}`);
            } else {
              console.error(`Failed to delete user ${userId}:`, error.message);
              failedUsers.push(userId);
            }
          } catch (err) {
            console.error(`Error deleting user ${userId}:`, err);
            failedUsers.push(userId);
          }
        }
        
        console.log(`Deleted ${deletedUsers}/${allUserIds.length} users from auth`);
        if (failedUsers.length > 0) {
          console.warn(`Failed to delete users: ${failedUsers.join(', ')}`);
          // Log the real cause for the first few; one blocker usually explains them all.
          for (const userId of failedUsers.slice(0, 5)) {
            await explainDeleteFailure(adminClient, userId);
          }
        }
        
        // Delete the institution (CASCADE rules will clean up remaining data)
        const { error: deleteError } = await adminClient
          .from("institutions")
          .delete()
          .eq("id", data.institutionId);
        
        if (deleteError) {
          console.error("Failed to delete institution:", deleteError);
          throw new Error(`Failed to delete institution: ${deleteError.message}`);
        }
        
        console.log("Institution deleted successfully");
        
        // Log audit event
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "institution_deleted",
          entity_type: "institution",
          entity_id: data.institutionId,
          entity_name: institution.name,
          old_values: { 
            institution_code: institution.code,
            users_deleted: deletedUsers,
            failed_deletions: failedUsers.length
          },
        });
        
        result = {
          message: `Institution "${institution.name}" and ${deletedUsers} user accounts have been permanently deleted.`,
          usersDeleted: deletedUsers,
          failedDeletions: failedUsers.length,
        };
        break;
      }

      case "delete_user": {
        const { data } = body as DeleteUserRequest;
        
        console.log("Deleting user:", data.userId);
        
        // Get user info for audit log
        const { data: profile } = await adminClient
          .from("profiles")
          .select("full_name, institution_id")
          .eq("id", data.userId)
          .single();
        
        if (!profile) {
          throw new Error("User not found");
        }
        
        // Delete from auth.users (will cascade to profiles, user_roles, and other related tables)
        const { error: authError } = await deleteAuthUserNoted(adminClient, data.userId, user.id, "app");
        
        if (authError) {
          console.error("Failed to delete user from auth:", authError);
          const { userMessage, diagnosis } = await explainDeleteFailure(adminClient, data.userId);

          // Keep the real cause where it can be found later, not just in the
          // function log. Deliberately not "*_deleted" / "*_removed*", so the
          // bulk-deletion alert scan (CLAUDE.md §29) does not count it.
          const { error: auditError } = await adminClient.from("system_audit_logs").insert({
            actor_id: user.id,
            action: "user_delete_blocked",
            entity_type: "user",
            entity_id: data.userId,
            entity_name: profile.full_name,
            old_values: { institution_id: profile.institution_id },
            metadata: { source: "admin-operations", gotrue_error: authError.message, diagnosis },
          });
          if (auditError) console.error("Failed to audit blocked delete:", auditError.message);

          throw new Error(userMessage);
        }
        
        console.log("User deleted successfully");
        
        // Log audit event
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "user_deleted",
          entity_type: "user",
          entity_id: data.userId,
          entity_name: profile.full_name,
          old_values: { institution_id: profile.institution_id },
        });
        
        result = {
          message: `User "${profile.full_name}" has been permanently deleted.`,
        };
        break;
      }

      case "update_ai_config": {
        const { data } = body as UpdateAIConfigRequest;

        // Get current value for audit
        const { data: existing } = await adminClient
          .from("global_ai_config")
          .select("*")
          .eq("config_key", data.configKey)
          .single();

        // Upsert config
        const { data: config, error } = await adminClient
          .from("global_ai_config")
          .upsert({
            config_key: data.configKey,
            config_value: data.configValue,
            is_enabled: data.isEnabled,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          }, { onConflict: "config_key" })
          .select()
          .single();

        if (error) throw new Error(`Failed to update config: ${error.message}`);

        // Log audit
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "ai_config_updated",
          entity_type: "ai_config",
          entity_name: data.configKey,
          old_values: existing,
          new_values: config,
        });

        // Log config change
        await adminClient.from("ai_config_changes").insert({
          config_key: data.configKey,
          old_value: existing?.config_value || null,
          new_value: data.configValue,
          change_type: existing ? "update" : "create",
          changed_by: user.id,
        });

        result = { config, message: "AI configuration updated" };
        break;
      }

      case "update_quota": {
        const { data } = body as UpdateQuotaRequest;

        const updateData: Record<string, any> = {};
        if (data.dailyQuestionLimit !== undefined) updateData.daily_question_limit = data.dailyQuestionLimit;
        if (data.dailyTokenLimit !== undefined) updateData.daily_token_limit = data.dailyTokenLimit;
        if (data.monthlyTokenLimit !== undefined) updateData.monthly_token_limit = data.monthlyTokenLimit;
        if (data.questionGenerationEnabled !== undefined) updateData.question_generation_enabled = data.questionGenerationEnabled;
        if (data.ocrEnabled !== undefined) updateData.ocr_enabled = data.ocrEnabled;

        const { data: quota, error } = await adminClient
          .from("ai_usage_quotas")
          .update(updateData)
          .eq("institution_id", data.institutionId)
          .select()
          .single();

        if (error) throw new Error(`Failed to update quota: ${error.message}`);

        // Log audit
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "quota_updated",
          entity_type: "ai_quota",
          entity_id: data.institutionId,
          new_values: updateData,
          metadata: { institution_id: data.institutionId },
        });

        result = { quota, message: "Quota updated successfully" };
        break;
      }

      case "reset_user_password": {
        const { data } = body as ResetUserPasswordRequest;
        
        if (!data.userId || !data.newPassword) {
          throw new Error("User ID and new password are required");
        }
        
        if (data.newPassword.length < 6) {
          throw new Error("Password must be at least 6 characters");
        }
        
        // Get user info for audit log
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("full_name, email, institution_id")
          .eq("id", data.userId)
          .single();
        
        if (!targetProfile) {
          throw new Error("User not found");
        }
        
        // Authorization — mirrors update_user (this action was previously
        // absent from the top authorization switch, so a caller with NO
        // privileged role, e.g. a student, could fall straight through and
        // reset any same-institution user's password, including a
        // school_admin's — full account takeover). A user may hold multiple
        // roles, so fetch the full list (not .single(), which errors on >1).
        const { data: targetRoles } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", data.userId);

        const targetRoleList = (targetRoles ?? []).map((r) => r.role as string);
        const targetIsSuperAdmin = targetRoleList.includes("super_admin");
        const targetIsSchoolAdmin =
          targetRoleList.includes("school_admin") || targetRoleList.includes("super_school_admin");
        const targetIsCoordinator = targetRoleList.includes("coordinator");

        // Only a super admin may reset a super admin.
        if (targetIsSuperAdmin && !isSuperAdmin) {
          throw new Error("You cannot reset a super admin's password");
        }

        if (!isSuperAdmin) {
          // Only administrators and coordinators may reset passwords — teachers,
          // students and employees cannot.
          if (!isSchoolAdmin && !isCoordinator) {
            throw new Error("You do not have permission to reset passwords");
          }
          // Same-institution only.
          if (!userInstitutionId || userInstitutionId !== targetProfile.institution_id) {
            throw new Error("You can only reset passwords for users in your institution");
          }
          // School admin cannot reset another school admin (except self).
          if (isSchoolAdmin && targetIsSchoolAdmin && data.userId !== user.id) {
            throw new Error("You cannot reset another school admin's password");
          }
          // Coordinators (non-school-admin) cannot reset admins or fellow coordinators.
          if (!isSchoolAdmin && (targetIsSchoolAdmin || targetIsCoordinator)) {
            throw new Error("You cannot reset this user's password");
          }
        }
        
        // Reset password using admin API
        const { error: updateError } = await adminClient.auth.admin.updateUserById(
          data.userId,
          { password: data.newPassword }
        );
        
        if (updateError) {
          console.error("Password reset error:", updateError);
          throw new Error(`Failed to reset password: ${updateError.message}`);
        }
        
        // Update profile to clear must_reset_password flag if it was set
        await adminClient
          .from("profiles")
          .update({ 
            must_reset_password: false,
            password_expires_at: null 
          })
          .eq("id", data.userId);
        
        // Determine caller's role for audit (teachers can no longer reach this path).
        const callerRole = isSuperAdmin ? "super_admin" : isSchoolAdmin ? "school_admin" : isCoordinator ? "coordinator" : "unknown";

        // Log audit event — records who (actor_id) reset whose (entity_id/name)
        // password, when, and under which role. Surfaced in the Audit Logs viewer.
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "password_reset",
          entity_type: "user",
          entity_id: data.userId,
          entity_name: targetProfile.full_name || targetProfile.email,
          metadata: {
            target_institution: targetProfile.institution_id,
            target_email: targetProfile.email,
            reset_by_role: callerRole
          },
        });
        
        console.log("Password reset successfully for user:", data.userId);
        
        result = {
          message: `Password reset successfully for ${targetProfile.full_name || targetProfile.email}`,
          success: true
        };
        break;
      }

      case "update_user": {
        const { data } = body as UpdateUserRequest;

        if (!data.userId || !data.updates) {
          throw new Error("User ID and updates are required");
        }

        const email = data.updates.email?.trim();
        const password = data.updates.password;

        if (!email && !password) {
          throw new Error("At least one of email or password must be provided");
        }

        if (email) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            throw new Error("Invalid email format");
          }
        }

        if (password && password.length < 6) {
          throw new Error("Password must be at least 6 characters");
        }

        // Get target user info
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("full_name, email, institution_id")
          .eq("id", data.userId)
          .single();

        if (!targetProfile) {
          throw new Error("User not found");
        }

        // Authorization — mirrors reset_user_password rules. Coordinators
        // may update teachers/students in their institution but not admins
        // or fellow coordinators.
        const { data: targetRoles } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", data.userId);

        const targetRoleList = (targetRoles ?? []).map(r => r.role as string);
        const targetIsSchoolAdmin = targetRoleList.includes("school_admin") || targetRoleList.includes("super_school_admin");
        const targetIsCoordinator = targetRoleList.includes("coordinator");

        if (!isSuperAdmin) {
          if (!isSchoolAdmin && !isCoordinator) {
            throw new Error("You do not have permission to update users");
          }
          if (!userInstitutionId || userInstitutionId !== targetProfile.institution_id) {
            throw new Error("You can only update users in your institution");
          }
          if (isSchoolAdmin && targetIsSchoolAdmin && data.userId !== user.id) {
            throw new Error("You cannot update another school admin's credentials");
          }
          if (isCoordinator && !isSchoolAdmin && (targetIsSchoolAdmin || (targetIsCoordinator && data.userId !== user.id))) {
            throw new Error("You cannot update this user's credentials");
          }
        }

        const authUpdate: { email?: string; password?: string } = {};
        if (email) authUpdate.email = email;
        if (password) authUpdate.password = password;

        const { error: updateError } = await adminClient.auth.admin.updateUserById(
          data.userId,
          authUpdate
        );

        if (updateError) {
          console.error("User update error:", updateError);
          throw new Error(`Failed to update user: ${updateError.message}`);
        }

        // Keep profiles.email in sync (no DB trigger syncs auth → profiles on update)
        if (email) {
          await adminClient
            .from("profiles")
            .update({ email })
            .eq("id", data.userId);
        }

        // Clear must_reset flag when password changes
        if (password) {
          await adminClient
            .from("profiles")
            .update({ must_reset_password: false, password_expires_at: null })
            .eq("id", data.userId);
        }

        const callerRole = isSuperAdmin
          ? "super_admin"
          : isSchoolAdmin
            ? "school_admin"
            : isCoordinator
              ? "coordinator"
              : "unknown";

        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "user_updated",
          entity_type: "user",
          entity_id: data.userId,
          entity_name: targetProfile.full_name || targetProfile.email,
          new_values: {
            email_changed: !!email,
            password_changed: !!password,
          },
          metadata: {
            target_institution: targetProfile.institution_id,
            updated_by_role: callerRole,
          },
        });

        console.log("User updated successfully:", data.userId);

        result = {
          message: `Updated ${targetProfile.full_name || targetProfile.email}`,
          success: true,
        };
        break;
      }

      case "bulk_update_student_profiles": {
        const { data } = body as BulkUpdateStudentProfilesRequest;
        
        if (!data.institutionId) {
          throw new Error("Institution ID is required");
        }
        
        if (!data.students || !Array.isArray(data.students) || data.students.length === 0) {
          throw new Error("Students array is required and must not be empty");
        }
        
        // Authorization — admins (institution-wide), or coordinators/teachers
        // (scoped to their own classes, enforced per-student below).
        if (!isSuperAdmin && !isSchoolAdmin && !isCoordinator && !isTeacher) {
          throw new Error("You don't have permission to update students.");
        }

        // Non-super-admins can only operate within their own institution.
        if (!isSuperAdmin && userInstitutionId !== data.institutionId) {
          throw new Error("You can only update students in your own institution");
        }

        // For coordinators/teachers (NOT full admins), resolve the set of
        // student ids inside the classes they own. adminClient bypasses RLS,
        // so this scope MUST be code-enforced. null = admin → no class filter.
        let allowedStudentIds: Set<string> | null = null;
        if (!isSuperAdmin && !isSchoolAdmin) {
          allowedStudentIds = new Set<string>();
          const allowedClassIds = new Set<string>();

          if (isTeacher) {
            // Subject-scoped (policy 2026-08-26): a teacher's bulk edits reach
            // only students of their own subjects, not the whole class. The
            // roster RPC must run as the CALLER (supabaseClient carries their
            // JWT) - its guard fails closed on service-role / NULL auth.
            const { data: taught, error: taughtErr } = await adminClient
              .from("class_assignments")
              .select("class_id")
              .eq("user_id", user.id)
              .eq("role", "teacher");
            if (taughtErr) throw taughtErr;
            const taughtIds = [...new Set((taught ?? []).map((r) => r.class_id).filter(Boolean))];
            if (taughtIds.length > 0) {
              const { data: roster, error: rosterErr } = await supabaseClient.rpc(
                "teacher_roster_student_ids",
                { _teacher: user.id, _class_ids: taughtIds },
              );
              if (rosterErr) throw rosterErr;
              for (const r of roster ?? []) if (r.student_id) allowedStudentIds.add(r.student_id);
            }
          }

          if (isCoordinator) {
            const { data: wings, error: wingsErr } = await adminClient
              .from("wing_assignments")
              .select("wing_id")
              .eq("user_id", user.id);
            if (wingsErr) throw wingsErr;
            const wingIds = (wings ?? []).map((w) => w.wing_id).filter(Boolean);
            if (wingIds.length > 0) {
              // Active classes only — mirrors useCoordinatorClasses so the bulk
              // path and the roll picker resolve the same wing scope.
              const { data: maps, error: mapsErr } = await adminClient
                .from("wing_class_mappings")
                .select("class_id, classes:class_id(is_active)")
                .in("wing_id", wingIds);
              if (mapsErr) throw mapsErr;
              for (const r of maps ?? []) {
                const cls = Array.isArray(r.classes) ? r.classes[0] : r.classes;
                if (r.class_id && cls?.is_active) allowedClassIds.add(r.class_id);
              }
            }
          }

          // Paginated — a large wing can exceed PostgREST's 1000-row cap.
          // (Coordinator scope stays class-wide; only teachers narrowed.)
          const classIdList = [...allowedClassIds];
          if (classIdList.length > 0) {
            const PAGE = 1000;
            let from = 0;
            while (true) {
              const { data: rows, error: rowsErr } = await adminClient
                .from("class_assignments")
                .select("user_id")
                .eq("role", "student")
                .in("class_id", classIdList)
                .range(from, from + PAGE - 1);
              if (rowsErr) throw rowsErr;
              for (const r of rows ?? []) if (r.user_id) allowedStudentIds.add(r.user_id);
              if (!rows || rows.length < PAGE) break;
              from += PAGE;
            }
          }
        }

        const results = {
          updated: 0,
          notFound: [] as string[],
          outOfScope: [] as string[],
          errors: [] as Array<{ email: string; message: string }>,
        };
        
        console.log(`Starting bulk update for ${data.students.length} students in institution ${data.institutionId}`);
        
        for (const student of data.students) {
          if (!student.email) {
            results.notFound.push("(empty email)");
            continue;
          }
          
          try {
            // Find profile by email within institution (case-insensitive)
            const { data: profile, error: findError } = await adminClient
              .from("profiles")
              .select("id, admission_number, phone, roll_number")
              .eq("institution_id", data.institutionId)
              .ilike("email", student.email)
              .single();
            
            if (findError || !profile) {
              results.notFound.push(student.email);
              continue;
            }

            // SECURITY: sole server-side scope gate for coordinator/teacher bulk
            // edits (adminClient bypasses RLS). Removing this re-opens
            // institution-wide editing for any non-admin caller. allowedStudentIds
            // is null only for full admins (intentionally unscoped).
            if (allowedStudentIds !== null && !allowedStudentIds.has(profile.id)) {
              results.outOfScope.push(student.email);
              continue;
            }

            // Build update object - only include non-empty values
            const updateData: Record<string, string> = {
              updated_at: new Date().toISOString(),
            };
            
            if (student.admissionNumber && student.admissionNumber.trim()) {
              updateData.admission_number = student.admissionNumber.trim();
            }
            if (student.phone && student.phone.trim()) {
              updateData.phone = student.phone.trim();
            }
            if (student.rollNumber && student.rollNumber.trim()) {
              updateData.roll_number = student.rollNumber.trim();
            }
            
            // Only update if there's something to update
            if (Object.keys(updateData).length > 1) { // > 1 because updated_at is always included
              const { error: updateError } = await adminClient
                .from("profiles")
                .update(updateData)
                .eq("id", profile.id);
              
              if (updateError) {
                results.errors.push({ email: student.email, message: updateError.message });
                continue;
              }
            }
            
            results.updated++;
          } catch (err: any) {
            results.errors.push({ email: student.email, message: err.message || "Unknown error" });
          }
        }
        
        console.log(`Bulk update completed: ${results.updated} updated, ${results.notFound.length} not found, ${results.outOfScope.length} out of scope, ${results.errors.length} errors`);

        // Log audit event
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "bulk_update_student_profiles",
          entity_type: "institution",
          entity_id: data.institutionId,
          entity_name: `Bulk update ${data.students.length} students`,
          new_values: {
            total_requested: data.students.length,
            updated: results.updated,
            not_found: results.notFound.length,
            out_of_scope: results.outOfScope.length,
            errors: results.errors.length,
          },
          metadata: { institution_id: data.institutionId },
        });
        
        result = { success: true, results };
        break;
      }

      case "bulk_delete_students": {
        const { data } = body as BulkDeleteStudentsRequest;
        const batchSize = data.batchSize || 50;

        // Get all student user IDs for this institution
        const { data: studentRoles, error: fetchError } = await adminClient
          .from("user_roles")
          .select("user_id, profiles!inner(institution_id)")
          .eq("role", "student")
          .eq("profiles.institution_id", data.institutionId);

        if (fetchError) {
          throw new Error(`Failed to fetch students: ${fetchError.message}`);
        }

        const studentIds = studentRoles?.map((r: any) => r.user_id) || [];
        console.log(`Found ${studentIds.length} students to delete for institution ${data.institutionId}`);

        let deleted = 0;
        let failed = 0;
        const failedIds: string[] = [];

        // Process in batches
        for (let i = 0; i < studentIds.length; i += batchSize) {
          const batch = studentIds.slice(i, i + batchSize);
          for (const userId of batch) {
            try {
              const { error: deleteError } = await deleteAuthUserNoted(adminClient, userId, user.id, "app:bulk_delete_students");
              if (deleteError) {
                console.error(`Failed to delete user ${userId}:`, deleteError.message);
                failed++;
                failedIds.push(userId);
              } else {
                deleted++;
              }
            } catch (err) {
              console.error(`Error deleting user ${userId}:`, err);
              failed++;
              failedIds.push(userId);
            }
          }
          console.log(`Batch progress: ${Math.min(i + batchSize, studentIds.length)}/${studentIds.length}`);
        }

        // Log the real cause for the first few; one blocker usually explains them all.
        for (const userId of failedIds.slice(0, 5)) {
          await explainDeleteFailure(adminClient, userId);
        }

        // Log audit event
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "bulk_delete_students",
          entity_type: "institution",
          entity_id: data.institutionId,
          entity_name: `Bulk deleted ${deleted} students`,
          new_values: { total: studentIds.length, deleted, failed, failedIds },
          metadata: { institution_id: data.institutionId },
        });

        result = { success: true, total: studentIds.length, deleted, failed, failedIds };
        break;
      }

      case "get_last_sign_in": {
        const { data } = body as GetLastSignInRequest;

        // Admins and coordinators only — same gate as the teacher-management UI
        if (!isSuperAdmin && !isSchoolAdmin && !isCoordinator) {
          throw new Error("You do not have permission to view sign-in data");
        }

        if (!Array.isArray(data.userIds) || data.userIds.length === 0) {
          result = { signIns: [] };
          break;
        }

        // Cap batch size — this iterates one auth call per user
        if (data.userIds.length > 500) {
          throw new Error("Too many users in one request (max 500)");
        }

        // Non-super-admins: every targeted user must belong to caller's institution
        if (!isSuperAdmin) {
          const { data: targetRoles, error: rolesError } = await adminClient
            .from("user_roles")
            .select("user_id, institution_id")
            .in("user_id", data.userIds);

          if (rolesError) {
            throw new Error(`Failed to verify users: ${rolesError.message}`);
          }

          const outOfInstitution = (targetRoles || []).filter(
            (r: { institution_id: string | null }) => r.institution_id !== userInstitutionId
          );
          if (outOfInstitution.length > 0) {
            throw new Error("Cannot read sign-in data for users outside your institution");
          }
        }

        const signIns: Array<{ userId: string; lastSignInAt: string | null }> = [];
        for (const userId of data.userIds) {
          try {
            const { data: u } = await adminClient.auth.admin.getUserById(userId);
            signIns.push({
              userId,
              lastSignInAt: u?.user?.last_sign_in_at ?? null,
            });
          } catch (err) {
            console.error(`Failed to fetch sign-in for ${userId}:`, err);
            signIns.push({ userId, lastSignInAt: null });
          }
        }

        result = { signIns };
        break;
      }

      case "admit_student": {
        const { data } = body as AdmitStudentRequest;
        const isAuto = data.admissionNumberIsAuto === true;

        // 1. Everything that can be refused is refused before an account exists.
        const { data: check, error: checkError } = await adminClient.rpc("admission_admit_check", {
          _id: data.enquiryId,
          _actor: user.id,
          _class_id: data.classId,
          _admission_number: typeof data.admissionNumber === "string" ? data.admissionNumber : null,
          _is_auto: isAuto,
        });
        if (checkError) {
          throw new Error(checkError.message);
        }

        // 2. The sign-in account. A placeholder address, never the guardian's
        // (siblings share it): the student signs in with the admission number.
        const fullName = String(data.fullName ?? "").trim().slice(0, 120) || "Student";
        const email = `adm.${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}@temp.local`;
        const password = admissionPassword();
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
        if (authError || !authUser?.user) {
          console.error("admit_student: createUser failed:", authError?.message);
          throw new Error("Couldn't make the student's sign-in account. Please try again.");
        }
        const newId = authUser.user.id;

        // 3. Profile, role, section, personal details, certificates and the
        // enquiry's stage in one transaction; a failure removes the account.
        const { data: admitted, error: admitError } = await adminClient.rpc("admission_admit_tx", {
          _id: data.enquiryId,
          _profile_id: newId,
          _actor: user.id,
          _fields: {
            full_name: data.fullName,
            date_of_birth: data.dateOfBirth,
            gender: data.gender,
            guardian_name: data.guardianName,
            guardian_phone: data.guardianPhone,
            guardian_email: data.guardianEmail ?? null,
            class_id: data.classId,
            admission_number: typeof data.admissionNumber === "string" ? data.admissionNumber : null,
            admission_number_is_auto: isAuto,
            admitted_on: data.admittedOn ?? null,
            previous_school: data.previousSchool ?? null,
            form: data.form && typeof data.form === "object" ? data.form : {},
            documents: Array.isArray(data.documents) ? data.documents.slice(0, 60) : [],
          },
        });
        if (admitError) {
          const { error: undoError } = await deleteAuthUserNoted(adminClient, newId, user.id, "admission_rollback");
          if (undoError) {
            console.error("admit_student: could not remove the half-made account", newId, undoError.message);
          }
          throw new Error(admitError.message);
        }

        const admissionNumber =
          (admitted as { admission_number?: string } | null)?.admission_number ??
          (check as { admission_number?: string } | null)?.admission_number ??
          "";
        await adminClient.from("system_audit_logs").insert({
          actor_id: user.id,
          action: "user_created",
          entity_type: "user",
          entity_id: newId,
          entity_name: fullName,
          new_values: { email, role: "student", admission_number: admissionNumber },
          metadata: { institution_id: data.institutionId, source: "admission", enquiry_id: data.enquiryId },
        });

        result = { profile_id: newId, admission_number: admissionNumber, login_id: admissionNumber, password };
        break;
      }

      default:
        throw new Error("Unknown action");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Admin operation error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: error instanceof AuthFailure ? error.status : 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});

/** A first password for a newly admitted child: 10 characters a child can type
 *  (no look-alikes, no symbols), from the crypto RNG, with a capital, a small
 *  letter and a digit. The account must change it at first sign-in. */
function admissionPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const rand = (n: number) => {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0] % n;
  };
  const chars = [upper[rand(upper.length)], lower[rand(lower.length)], digits[rand(digits.length)]];
  while (chars.length < 10) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
