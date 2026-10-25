import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

export interface TopicResult {
  id: string;
  topicName: string;
  topicNameLocal?: string | null;
  source: "school" | "cbse";
  usageCount?: number;
}

export function useTopicSearch(subjectId?: string | null) {
  const { institutionId } = useEffectiveInstitution();
  const [searchTerm, setSearchTerm] = useState("");

  const query = useQuery({
    queryKey: ["topic-search", institutionId, subjectId, searchTerm],
    queryFn: async (): Promise<TopicResult[]> => {
      if (!searchTerm || searchTerm.length < 2) return [];

      const results: TopicResult[] = [];

      // Query A: school_custom_topics
      const { data: schoolTopics } = await supabase
        .from("school_custom_topics")
        .select("id, topic_name, topic_name_local, usage_count")
        .eq("institution_id", institutionId!)
        .eq("subject_id", subjectId!)
        .eq("status", "active")
        .ilike("topic_name", `%${searchTerm}%`)
        .order("usage_count", { ascending: false })
        .limit(8);

      if (schoolTopics) {
        results.push(...schoolTopics.map(t => ({
          id: t.id,
          topicName: t.topic_name,
          topicNameLocal: t.topic_name_local,
          source: "school" as const,
          usageCount: t.usage_count ?? 0,
        })));
      }

      // Query B: syllabus_topics
      const { data: syllabusTopics } = await supabase
        .from("syllabus_topics")
        .select("id, topic_name, topic_name_hindi")
        .eq("subject_id", subjectId!)
        .ilike("topic_name", `%${searchTerm}%`)
        .limit(5);

      if (syllabusTopics) {
        // Filter out duplicates already in school results
        const schoolNames = new Set(results.map(r => r.topicName.toLowerCase()));
        results.push(...syllabusTopics
          .filter(t => !schoolNames.has(t.topic_name.toLowerCase()))
          .map(t => ({
            id: t.id,
            topicName: t.topic_name,
            topicNameLocal: t.topic_name_hindi,
            source: "cbse" as const,
          })));
      }

      return results;
    },
    enabled: !!institutionId && !!subjectId && searchTerm.length >= 2,
    staleTime: 10 * 1000,
  });

  return {
    results: query.data || [],
    isSearching: query.isLoading,
    searchTerm,
    setSearchTerm,
  };
}
