export { MCQForm } from "./MCQForm";
export { TrueFalseForm } from "./TrueFalseForm";
export { FillInBlankForm } from "./FillInBlankForm";
export { SubjectiveForm } from "./SubjectiveForm";
export { MatchColumnForm } from "./MatchColumnForm";
export { NumericalForm } from "./NumericalForm";
export { ComprehensionForm } from "./ComprehensionForm";
export { MarksHeader } from "./MarksHeader";
export { DiagramField } from "./DiagramField";
export type { ManualFormBaseProps } from "./formShared";

import type { QuestionType } from "@/types/exam";
import type { ComponentType } from "react";
import type { ManualFormBaseProps } from "./formShared";
import { MCQForm } from "./MCQForm";
import { TrueFalseForm } from "./TrueFalseForm";
import { FillInBlankForm } from "./FillInBlankForm";
import { SubjectiveForm } from "./SubjectiveForm";
import { MatchColumnForm } from "./MatchColumnForm";
import { NumericalForm } from "./NumericalForm";
import { ComprehensionForm } from "./ComprehensionForm";

/**
 * Given a question type, return the form component to author it.
 * Used by ManualEntrySheet to pick the right form when the teacher
 * taps "Manual entry" from the method picker.
 */
export function formForType(
  type: QuestionType
): ComponentType<ManualFormBaseProps> {
  switch (type) {
    case "mcq":
    case "checkbox":
      return MCQForm;
    case "true_false":
      return TrueFalseForm;
    case "fill_blank":
      return FillInBlankForm;
    case "short_answer":
    case "long_answer":
      return SubjectiveForm;
    case "matching":
    case "match_column":
      return MatchColumnForm;
    case "numerical":
      return NumericalForm;
    case "comprehension":
    case "case_study":
      return ComprehensionForm;
    default:
      return SubjectiveForm;
  }
}
