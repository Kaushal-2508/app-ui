/**
 * What each PTM feedback number counts, in the words the "i" buttons show.
 * One place, so the dashboard cards and the breakdown table never explain
 * the same number two ways. Keep them true to ptm_feedback_summary.
 */
export const PTM_METRIC_HELP = {
  students:
    "Students in the classes this row covers. Each student counts as one family, because families send feedback from their child's account.",
  classes: "Classes in this wing that the PTM was scheduled for.",
  responded: "Families who sent feedback. One response per student; editing it later does not add another.",
  responseRate:
    "Responded divided by Students, as a percentage. 0% means no family in the row has sent feedback yet.",
  averageRating:
    "The mean of the star ratings families gave, from 1 (Poor) to 5 (Excellent). In a total every response counts once, so a large class weighs more than a small one. Families yet to respond are left out.",
  responses:
    "Families who sent feedback, out of the students in the classes you can see. The rest are yet to respond.",
  classesCompared:
    "The highest and lowest average rating among classes with at least one rating. Shows once two or more classes have been rated.",
  slotsBooked: "Time slots families booked, out of the slots the meeting offers these classes.",
  attended: "Booked families marked as attended.",
  slots:
    "Time slots families booked, out of all the slots the meeting offers. Attended counts booked families marked as attended, as a share of those booked.",
} as const;
