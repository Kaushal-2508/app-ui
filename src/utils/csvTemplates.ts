// CSV Template Generation Utility for Bulk Uploads

import { saveBlob } from "@/lib/native";

export interface CSVTemplate {
  headers: string[];
  sampleData: string[][];
  description: string;
}

export const templates: Record<string, CSVTemplate> = {
  teachers: {
    headers: ["name", "email", "phone_number", "password"],
    sampleData: [
      ["John Doe", "john@school.edu", "9876543210", "pass123"],
      ["Jane Smith", "jane@school.edu", "9876543211", ""],
    ],
    description: "Template for bulk uploading teachers. Password is optional (auto-generated if empty).",
  },
  students: {
    headers: ["name", "email", "phone_number", "admission_number", "roll_number"],
    sampleData: [
      ["Alice Johnson", "alice@school.edu", "9876543210", "ADM001", "1"],
      ["Bob Smith", "", "9876543211", "ADM002", "2"],
    ],
    description: "Template for bulk uploading students. Email is optional.",
  },
  classes: {
    headers: ["class_name", "section", "academic_year"],
    sampleData: [
      ["Grade 1", "A", "2024-25"],
      ["Grade 1", "B", "2024-25"],
      ["Grade 2", "A", "2024-25"],
      ["Grade 2", "B", "2024-25"],
    ],
    description: "Template for bulk uploading classes with sections",
  },
  grades: {
    headers: ["grade_name", "grade_number", "display_order"],
    sampleData: [
      ["Nursery", "0", "1"],
      ["LKG", "1", "2"],
      ["UKG", "2", "3"],
      ["Grade 1", "3", "4"],
      ["Grade 2", "4", "5"],
    ],
    description: "Template for bulk uploading grade levels",
  },
  subjects: {
    headers: ["subject_name", "subject_code", "grade_levels"],
    sampleData: [
      ["Mathematics", "MATH", "1,2,3,4,5,6,7,8,9,10,11,12"],
      ["English", "ENG", "1,2,3,4,5,6,7,8,9,10,11,12"],
      ["Science", "SCI", "1,2,3,4,5,6,7,8,9,10"],
      ["Physics", "PHY", "9,10,11,12"],
    ],
    description: "Template for bulk uploading subjects with associated grade levels",
  },
  topics: {
    headers: ["subject_name", "topic_name", "topic_order", "description"],
    sampleData: [
      ["Mathematics", "Algebra Basics", "1", "Introduction to algebraic expressions"],
      ["Mathematics", "Linear Equations", "2", "Solving linear equations"],
      ["Science", "Motion and Force", "1", "Newton's laws of motion"],
    ],
    description: "Template for bulk uploading topics for subjects",
  },
  study_materials: {
    headers: ["subject", "topic", "material_title", "material_type", "url_or_content"],
    sampleData: [
      ["Mathematics", "Algebra Basics", "Introduction Video", "video", "https://youtube.com/..."],
      ["Mathematics", "Algebra Basics", "Practice PDF", "pdf", "https://school.edu/..."],
      ["Science", "Motion and Force", "Lecture Notes", "document", "https://school.edu/..."],
    ],
    description: "Template for bulk uploading study materials for topics",
  },
  questions: {
    headers: ["question_text", "question_type", "marks", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "difficulty", "topic"],
    sampleData: [
      ["What is 2 + 2?", "mcq", "1", "3", "4", "5", "6", "B", "Basic addition", "easy", "Algebra Basics"],
      ["Explain Newton's first law", "long_answer", "5", "", "", "", "", "An object at rest stays at rest...", "Newton's first law", "medium", "Motion and Force"],
      ["Is Earth round?", "true_false", "1", "True", "False", "", "", "A", "Earth is approximately spherical", "easy", "Geography"],
    ],
    description: "Template for bulk uploading questions to the question bank",
  },
  users: {
    headers: ["name", "email", "password", "role"],
    sampleData: [
      ["Admin User", "admin@school.edu", "admin123", "school_admin"],
      ["Teacher One", "teacher1@school.edu", "teach123", "teacher"],
      ["Student One", "student1@school.edu", "student123", "student"],
    ],
    description: "Template for bulk uploading users with various roles",
  },
  coordinators: {
    headers: ["name", "email", "password"],
    sampleData: [
      ["Coordinator One", "coord1@school.edu", "coord123"],
      ["Coordinator Two", "coord2@school.edu", "coord456"],
    ],
    description: "Template for bulk uploading coordinators",
  },
  student_update: {
    headers: ["email", "admission_number", "phone", "roll_number"],
    sampleData: [
      ["alice@school.edu", "ADM001", "9876543210", "1"],
      ["bob@school.edu", "ADM002", "9876543211", "2"],
    ],
    description: "Template for updating existing student details (email is used to match records)",
  },
};

export function generateCSVContent(template: CSVTemplate): string {
  const headerRow = template.headers.join(",");
  const dataRows = template.sampleData.map(row => 
    row.map(cell => {
      // Escape cells that contain commas or quotes
      if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(",")
  );
  return [headerRow, ...dataRows].join("\n");
}

export function downloadTemplate(templateType: keyof typeof templates, filename?: string): void {
  const template = templates[templateType];
  if (!template) {
    console.error(`Template type "${templateType}" not found`);
    return;
  }

  const csvContent = generateCSVContent(template);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  saveBlob(blob, filename || `${templateType}_template.csv`);
}

export function getTemplateDescription(templateType: keyof typeof templates): string {
  return templates[templateType]?.description || "";
}

export function getTemplateHeaders(templateType: keyof typeof templates): string[] {
  return templates[templateType]?.headers || [];
}
