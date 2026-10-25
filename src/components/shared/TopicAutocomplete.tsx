import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAddCustomTopic } from "@/hooks/useTopics";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";

interface TopicAutocompleteProps {
  institutionId: string | null;
  subjectId: string;
  gradeLevelId: string;
  value: string | null;
  topicName: string;
  onChange: (topicId: string | null, topicName: string) => void;
  disabled?: boolean;
}

interface TopicOption {
  id: string;
  topic_name: string;
  source: "global" | "custom";
}

export function TopicAutocomplete({
  institutionId,
  subjectId,
  gradeLevelId,
  value,
  topicName,
  onChange,
  disabled = false,
}: TopicAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(topicName);
  const [isCreating, setIsCreating] = useState(false);

  const addCustomTopic = useAddCustomTopic();

  // Fetch global syllabus topics
  const { data: globalTopics = [] } = useQuery({
    queryKey: ["global-topics", subjectId, gradeLevelId],
    queryFn: async () => {
      if (!subjectId) return [];

      let query = supabase
        .from("syllabus_topics")
        .select("id, topic_name")
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .order("display_order");

      if (gradeLevelId) {
        query = query.eq("grade_level_id", gradeLevelId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((t) => ({
        id: t.id,
        topic_name: t.topic_name,
        source: "global" as const,
      }));
    },
    enabled: !!subjectId,
  });

  // Fetch school custom topics
  const { data: customTopics = [] } = useQuery({
    queryKey: ["school-topics-autocomplete", institutionId, subjectId, gradeLevelId],
    queryFn: async () => {
      if (!institutionId || !subjectId) return [];

      let query = supabase
        .from("school_custom_topics")
        .select("id, topic_name")
        .eq("institution_id", institutionId)
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (gradeLevelId) {
        query = query.eq("grade_level_id", gradeLevelId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((t) => ({
        id: t.id,
        topic_name: t.topic_name,
        source: "custom" as const,
      }));
    },
    enabled: !!institutionId && !!subjectId,
  });

  // Combine and filter topics
  const allTopics = useMemo(() => {
    const combined = [...globalTopics, ...customTopics];
    // Remove duplicates by name
    const unique = combined.reduce((acc, topic) => {
      if (!acc.find((t) => t.topic_name.toLowerCase() === topic.topic_name.toLowerCase())) {
        acc.push(topic);
      }
      return acc;
    }, [] as TopicOption[]);
    return unique.sort((a, b) => a.topic_name.localeCompare(b.topic_name));
  }, [globalTopics, customTopics]);

  // Filter topics based on input
  const filteredTopics = useMemo(() => {
    if (!inputValue) return allTopics;
    return allTopics.filter((t) =>
      t.topic_name.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [allTopics, inputValue]);

  // Check if input matches existing topic exactly
  const exactMatch = allTopics.find(
    (t) => t.topic_name.toLowerCase() === inputValue.toLowerCase()
  );

  // Handle selecting a topic
  const handleSelect = (topic: TopicOption) => {
    setInputValue(topic.topic_name);
    onChange(topic.id, topic.topic_name);
    setOpen(false);
  };

  // Handle creating a new topic
  const handleCreateTopic = async () => {
    if (!institutionId || !subjectId || !gradeLevelId || !inputValue.trim()) return;

    setIsCreating(true);
    try {
      const result = await addCustomTopic.mutateAsync({
        institutionId,
        subjectId,
        gradeLevelId,
        topicName: inputValue.trim(),
      });

      onChange(result.id, result.topic_name);
      setOpen(false);
    } catch (error) {
      console.error("Failed to create topic:", error);
    } finally {
      setIsCreating(false);
    }
  };

  // Sync input with external value
  useEffect(() => {
    setInputValue(topicName);
  }, [topicName]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between", FIELD_FILL)}
            disabled={disabled || !subjectId}
          >
            {value && topicName ? (
              <span className="truncate">{topicName}</span>
            ) : (
              <span className="text-muted-foreground">Search or add chapter...</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type to search or add..."
              value={inputValue}
              onValueChange={setInputValue}
            />
            <CommandList>
              {filteredTopics.length === 0 && !inputValue && (
                <CommandEmpty>No topics found. Type to search or add.</CommandEmpty>
              )}

              {/* Existing topics */}
              {filteredTopics.length > 0 && (
                <CommandGroup heading="Existing Topics">
                  {filteredTopics.slice(0, 10).map((topic) => (
                    <CommandItem
                      key={topic.id}
                      value={topic.topic_name}
                      onSelect={() => handleSelect(topic)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === topic.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="flex-1">{topic.topic_name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "ml-2 text-xs",
                          topic.source === "global" ? "border-blue-500 text-blue-600" : "border-green-500 text-green-600"
                        )}
                      >
                        {topic.source === "global" ? "Standard" : "Custom"}
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Add new topic option */}
              {inputValue && !exactMatch && institutionId && subjectId && gradeLevelId && (
                <CommandGroup heading="Create New">
                  <CommandItem
                    value={`create-${inputValue}`}
                    onSelect={handleCreateTopic}
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    <span>
                      Add topic: <strong>"{inputValue}"</strong>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}

              {inputValue && !exactMatch && !institutionId && (
                <CommandEmpty>
                  <div className="text-center py-2 text-muted-foreground">
                    Select an institution to create custom chapters
                  </div>
                </CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Selected: {topicName}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1 text-xs"
            onClick={() => {
              onChange(null, "");
              setInputValue("");
            }}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}