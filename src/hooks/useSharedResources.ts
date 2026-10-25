import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

// =============================================================
// Shared resources — Phase 6 facade over the rebuilt tt_resources
// table. Callers (SharedResourcesPage, InstitutionWizard) continue
// to work with the legacy SharedResource shape; this module
// translates column names (resource_type ⇄ kind, count ⇄ capacity)
// so the rest of the app doesn't need to change when the old
// shared_resources table drops.
// =============================================================

export const RESOURCE_TYPES = [
  "lab",
  "library",
  "computer_room",
  "sports_facility",
  "other",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  lab: "Lab",
  library: "Library",
  computer_room: "Computer Room",
  sports_facility: "Sports Facility",
  other: "Other",
};

export interface SharedResource {
  id: string;
  institution_id: string;
  name: string;
  resource_type: ResourceType;
  count: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedResourceInput {
  name: string;
  resource_type: ResourceType;
  count: number;
  description?: string | null;
}

interface TtResourceRow {
  id: string;
  institution_id: string;
  name: string;
  kind: ResourceType;
  capacity: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToShared(r: TtResourceRow): SharedResource {
  return {
    id: r.id,
    institution_id: r.institution_id,
    name: r.name,
    resource_type: r.kind,
    count: r.capacity,
    description: r.description,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const LIST_KEY = "shared-resources";

export function useSharedResources() {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [LIST_KEY, institutionId],
    queryFn: async (): Promise<SharedResource[]> => {
      const { data, error } = await supabase
        .from("tt_resources" as never)
        .select("*")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as TtResourceRow[]).map(rowToShared);
    },
    enabled: !!institutionId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [LIST_KEY, institutionId] });
    queryClient.invalidateQueries({ queryKey: ["timetable-v2", "resources"] });
  };

  const createResource = useMutation({
    mutationFn: async (input: SharedResourceInput) => {
      const name = input.name.trim();
      if (!name) throw new Error("Resource name is required.");
      if (input.count < 1) throw new Error("Count must be at least 1.");

      const { data, error } = await supabase
        .from("tt_resources" as never)
        .insert({
          institution_id: institutionId!,
          name,
          kind: input.resource_type,
          capacity: input.count,
          description: input.description?.trim() || null,
        } as never)
        .select()
        .single();
      if (error) throw error;
      const createdId = (data as unknown as TtResourceRow).id;
      return createdId;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Shared resource added");
    },
    onError: (e: Error) => {
      if (/duplicate key|unique/i.test(e.message)) {
        toast.error("A resource with that name already exists.");
      } else {
        toastError(e, { fallback: "Couldn't add the shared resource.", context: "createSharedResource" });
      }
    },
  });

  const updateResource = useMutation({
    mutationFn: async (input: SharedResourceInput & { id: string }) => {
      const name = input.name.trim();
      if (!name) throw new Error("Resource name is required.");
      if (input.count < 1) throw new Error("Count must be at least 1.");

      const { error } = await supabase
        .from("tt_resources" as never)
        .update({
          name,
          kind: input.resource_type,
          capacity: input.count,
          description: input.description?.trim() || null,
        } as never)
        .eq("id", input.id);
      if (error) throw error;
      return input.id;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Shared resource updated");
    },
    onError: (e: Error) => {
      if (/duplicate key|unique/i.test(e.message)) {
        toast.error("A resource with that name already exists.");
      } else {
        toastError(e, { fallback: "Couldn't update the shared resource.", context: "updateSharedResource" });
      }
    },
  });

  const deleteResource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tt_resources" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Shared resource removed");
    },
    onError: (e: Error) => {
      if (/foreign key/i.test(e.message)) {
        toast.error(
          "This resource is referenced by the timetable. Remove those bookings first.",
        );
      } else {
        toastError(e, { fallback: "Couldn't remove the shared resource.", context: "deleteSharedResource" });
      }
    },
  });

  return {
    resources: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    createResource,
    updateResource,
    deleteResource,
  };
}
