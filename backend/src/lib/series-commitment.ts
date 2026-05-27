// #60: эффективный статус явки на занятие.
// Согласие на серию — дефолт "иду"; явный ответ на конкретное занятие (rsvps) — оверрайд.
// Generic: применимо к любому типу события (тренировка, чемпионат, ...).

export type EffectiveRsvpStatus = "PENDING" | "CONFIRMED" | "DECLINED" | "UNANSWERED";

export function resolveEffectiveRsvp(input: {
  explicit: "PENDING" | "CONFIRMED" | "DECLINED" | null;
  hasSeries: boolean;
  committedToSeries: boolean;
}): EffectiveRsvpStatus {
  // Явный ответ на это занятие всегда главнее (в т.ч. DECLINED = "сегодня не буду").
  if (input.explicit) return input.explicit;
  // Принял серию → по умолчанию "иду" на каждое занятие серии.
  if (input.hasSeries && input.committedToSeries) return "CONFIRMED";
  // Иначе ответа нет.
  return "UNANSWERED";
}
