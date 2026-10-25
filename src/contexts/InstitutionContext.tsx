import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ManagedInstitution {
  id: string;
  name: string;
  code: string;
}

interface InstitutionContextType {
  /** The institution ID the Super Admin is currently managing (null if not managing any) */
  managedInstitutionId: string | null;
  /** Full institution details */
  managedInstitution: ManagedInstitution | null;
  /** Whether Super Admin is currently in "manage institution" mode */
  isManagingInstitution: boolean;
  /** Start managing an institution */
  startManaging: (institutionId: string) => void;
  /** Stop managing and return to Super Admin view */
  stopManaging: () => void;
  /** Loading state */
  isLoading: boolean;
}

const InstitutionContext = createContext<InstitutionContextType | undefined>(undefined);

const STORAGE_KEY = "salci_managed_institution_id";

export function InstitutionProvider({ children }: { children: React.ReactNode }) {
  const [managedInstitutionId, setManagedInstitutionId] = useState<string | null>(() => {
    try {
      if (typeof window !== "undefined") {
        return sessionStorage.getItem(STORAGE_KEY);
      }
    } catch { /* storage unavailable */ }
    return null;
  });

  // Fetch institution details when managing
  const { data: managedInstitution, isLoading } = useQuery({
    queryKey: ["managed-institution", managedInstitutionId],
    queryFn: async () => {
      if (!managedInstitutionId) return null;
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("id", managedInstitutionId)
        .single();
      
      if (error) {
        console.error("Failed to fetch managed institution:", error);
        return null;
      }
      return data as ManagedInstitution;
    },
    enabled: !!managedInstitutionId,
  });

  const startManaging = useCallback((institutionId: string) => {
    setManagedInstitutionId(institutionId);
    try { sessionStorage.setItem(STORAGE_KEY, institutionId); } catch { /* noop */ }
  }, []);

  const stopManaging = useCallback(() => {
    setManagedInstitutionId(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  // Clear managed institution if it becomes invalid
  useEffect(() => {
    if (managedInstitutionId && !isLoading && !managedInstitution) {
      stopManaging();
    }
  }, [managedInstitutionId, managedInstitution, isLoading, stopManaging]);

  return (
    <InstitutionContext.Provider
      value={{
        managedInstitutionId,
        managedInstitution,
        isManagingInstitution: !!managedInstitutionId && !!managedInstitution,
        startManaging,
        stopManaging,
        isLoading,
      }}
    >
      {children}
    </InstitutionContext.Provider>
  );
}

export function useInstitutionContext() {
  const context = useContext(InstitutionContext);
  if (context === undefined) {
    throw new Error("useInstitutionContext must be used within an InstitutionProvider");
  }
  return context;
}

/**
 * Hook that returns the effective institution ID for the current user.
 * For Super Admins managing an institution, it returns the managed institution ID.
 * For other users, it returns their own institution ID from useUserRole.
 */
export function useEffectiveInstitutionId(userInstitutionId: string | null) {
  const { managedInstitutionId, isManagingInstitution } = useInstitutionContext();
  
  // If Super Admin is managing an institution, use that
  if (isManagingInstitution && managedInstitutionId) {
    return managedInstitutionId;
  }
  
  // Otherwise, use the user's own institution
  return userInstitutionId;
}
