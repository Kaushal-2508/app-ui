import { Layers, Lock, Loader2, Users } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  useNoticeClassStaff,
  useNoticeTargetOptions,
  type NoticeScope,
  type RecipientRole,
} from "@/hooks/notices";

import { NoticeChip } from "./NoticeBits";

export interface AudienceState {
  scope: NoticeScope;
  classIds: string[];
  wingIds: string[];
  audienceRoles: RecipientRole[];
  /** Empty means "all teachers of the chosen classes". */
  teacherIds: string[];
  allTeachers: boolean;
}

interface NoticeAudienceFieldsProps {
  value: AudienceState;
  onChange: (next: AudienceState) => void;
  /** Teachers address students only, so their staff controls are not rendered. */
  isTeacherOnly: boolean;
  /** Only admins may address the whole school. */
  canSendInstitutionWide: boolean;
  /** Only coordinators and admins may address a wing. */
  canSendWingWide: boolean;
  /** Bulk messages do not force the wing coordinator in, so they hide the
   *  locked chip that would otherwise promise a recipient who is not coming. */
  hideAutoCoordinator?: boolean;
}

const ROLE_OPTIONS: { value: RecipientRole; label: string }[] = [
  { value: "coordinator", label: "Coordinators" },
  { value: "teacher", label: "Teachers" },
  { value: "student", label: "Students" },
];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Checkbox rows inside a bordered, scrollable box. Two columns from sm up so
 *  a school with twenty sections is not a metre-long list on desktop. */
const PICK_LIST =
  "grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-surface-stroke p-2 sm:grid-cols-2";
const PICK_ROW =
  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200 hover:bg-surface-stroke/40";

/**
 * The audience half of the composer.
 *
 * Class scope drives everything: picking a class means its students receive the
 * notice, its wing coordinator is added and locked, and the author chooses which
 * of that class's teachers come along. The locked coordinator chip exists so a
 * teacher cannot notify a class while quietly cutting their coordinator out of
 * the loop.
 */
export function NoticeAudienceFields({
  value,
  onChange,
  isTeacherOnly,
  canSendInstitutionWide,
  canSendWingWide,
  hideAutoCoordinator = false,
}: NoticeAudienceFieldsProps) {
  const options = useNoticeTargetOptions();
  const staff = useNoticeClassStaff(value.scope === "class" ? value.classIds : []);

  const set = (patch: Partial<AudienceState>) => onChange({ ...value, ...patch });

  const classes = options.data?.classes ?? [];
  const wings = options.data?.wings ?? [];

  // A teacher can only address a class, so a one-item radio group would ask
  // them to choose between one thing. Say it in a sentence instead.
  const scopeChoices = 1 + (canSendInstitutionWide ? 1 : 0) + (canSendWingWide ? 1 : 0);

  return (
    <div className="space-y-4">
      {scopeChoices > 1 ? (
        <div className="space-y-2">
          <Label>Send to</Label>
          <RadioGroup
            value={value.scope}
            onValueChange={(v) =>
              set({ scope: v as NoticeScope, classIds: [], wingIds: [], teacherIds: [] })
            }
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6"
          >
            {canSendInstitutionWide && (
              <div className="flex items-center gap-2">
                <RadioGroupItem value="institution" id="scope-institution" />
                <Label htmlFor="scope-institution" className="cursor-pointer font-normal">
                  Whole school
                </Label>
              </div>
            )}
            {canSendWingWide && (
              <div className="flex items-center gap-2">
                <RadioGroupItem value="wing" id="scope-wing" />
                <Label htmlFor="scope-wing" className="cursor-pointer font-normal">
                  Specific wing
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="class" id="scope-class" />
              <Label htmlFor="scope-class" className="cursor-pointer font-normal">
                Specific class
              </Label>
            </div>
          </RadioGroup>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-600">
          <Layers className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
          Goes to the students of the classes you pick, and their wing coordinator.
        </p>
      )}

      {options.isLoading && (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your classes…
        </p>
      )}

      {options.isError && (
        <p className="text-sm text-ink-600">
          Couldn't load the classes you can send to. Close and reopen this form.
        </p>
      )}

      {/* ---- class scope ---- */}
      {value.scope === "class" && !options.isLoading && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Classes</Label>
            {classes.length === 0 ? (
              <p className="text-sm text-ink-600">
                You aren't assigned to any class yet, so there is nobody to send to.
              </p>
            ) : (
              <div className={PICK_LIST}>
                {classes.map((c) => (
                  <label key={c.id} className={PICK_ROW}>
                    <Checkbox
                      checked={value.classIds.includes(c.id)}
                      onCheckedChange={() =>
                        set({ classIds: toggle(value.classIds, c.id), teacherIds: [] })
                      }
                    />
                    <span className="min-w-0 truncate text-sm text-ink-800">{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {value.classIds.length > 0 && (
            <>
              {!hideAutoCoordinator && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-ink-500" aria-hidden />
                  Added automatically
                </Label>
                {staff.isLoading ? (
                  <p className="text-sm text-ink-500">Checking wings…</p>
                ) : staff.data && staff.data.coordinators.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {staff.data.coordinators.map((c) => (
                      <NoticeChip
                        key={c.user_id}
                        tone="violet"
                        icon={<Lock />}
                        className="px-2.5 py-1 text-[12px]"
                      >
                        {c.full_name ?? "Coordinator"}
                        {c.detail && <span className="opacity-70">· {c.detail}</span>}
                      </NoticeChip>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-500">
                    No wing coordinator is mapped to these classes.
                  </p>
                )}
                <p className="text-xs text-ink-500">
                  Wing coordinators always receive notices sent to their classes.
                </p>
              </div>
              )}

              {!isTeacherOnly && (
                <div className="space-y-2">
                  <Label>Teachers of these classes</Label>
                  <RadioGroup
                    value={value.allTeachers ? "all" : "some"}
                    onValueChange={(v) =>
                      set({
                        allTeachers: v === "all",
                        teacherIds: v === "all" ? [] : value.teacherIds,
                      })
                    }
                    className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="all" id="teachers-all" />
                      <Label htmlFor="teachers-all" className="cursor-pointer font-normal">
                        All teachers
                        {staff.data ? ` (${staff.data.teachers.length})` : ""}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="some" id="teachers-some" />
                      <Label htmlFor="teachers-some" className="cursor-pointer font-normal">
                        Choose specific teachers
                      </Label>
                    </div>
                  </RadioGroup>

                  {!value.allTeachers && (
                    <div className={PICK_LIST}>
                      {(staff.data?.teachers ?? []).map((t) => (
                        <label key={t.user_id} className={PICK_ROW}>
                          <Checkbox
                            checked={value.teacherIds.includes(t.user_id)}
                            onCheckedChange={() =>
                              set({ teacherIds: toggle(value.teacherIds, t.user_id) })
                            }
                          />
                          <span className="min-w-0 text-sm text-ink-800">
                            <span className="truncate">{t.full_name ?? "Teacher"}</span>
                            {t.detail && (
                              <span className="text-ink-500"> · {t.detail}</span>
                            )}
                          </span>
                        </label>
                      ))}
                      {(staff.data?.teachers ?? []).length === 0 && (
                        <p className="px-2 py-1 text-sm text-ink-500 sm:col-span-2">
                          No teachers are assigned to these classes.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---- wing scope ---- */}
      {value.scope === "wing" && !options.isLoading && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Wings</Label>
            {wings.length === 0 ? (
              <p className="text-sm text-ink-600">
                You aren't assigned to a wing yet.
              </p>
            ) : (
              <div className={PICK_LIST}>
                {wings.map((w) => (
                  <label key={w.id} className={PICK_ROW}>
                    <Checkbox
                      checked={value.wingIds.includes(w.id)}
                      onCheckedChange={() => set({ wingIds: toggle(value.wingIds, w.id) })}
                    />
                    <span className="min-w-0 truncate text-sm text-ink-800">{w.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <AudienceRolePicker value={value} onToggle={(r) => set({ audienceRoles: toggle(value.audienceRoles, r) })} />
        </div>
      )}

      {/* ---- institution scope ---- */}
      {value.scope === "institution" && (
        <AudienceRolePicker
          value={value}
          onToggle={(r) => set({ audienceRoles: toggle(value.audienceRoles, r) })}
        />
      )}
    </div>
  );
}

function AudienceRolePicker({
  value,
  onToggle,
}: {
  value: AudienceState;
  onToggle: (role: RecipientRole) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-ink-500" aria-hidden />
        Who should receive it
      </Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLE_OPTIONS.map((r) => {
          const checked = value.audienceRoles.includes(r.value);
          return (
            <label
              key={r.value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors duration-200 ${
                checked
                  ? "border-brand-primary/50 bg-brand-primary/5"
                  : "border-surface-stroke hover:bg-surface-stroke/40"
              }`}
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggle(r.value)} />
              <span className="text-sm text-ink-800">{r.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
