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

// #60 (фид): статус занятия в календаре/дашборде. Тот же закон, что и в списке
// участников: явный ответ — оверрайд, согласие на серию — дефолт "иду".
// seriesCommitted уже учитывает наличие серии (TRUE только для занятий серии,
// на которые игрок согласился), поэтому hasSeries здесь = seriesCommitted.
export function resolveFeedRsvpStatus(input: {
  explicit: "PENDING" | "CONFIRMED" | "DECLINED" | null;
  seriesCommitted: boolean;
}): EffectiveRsvpStatus {
  return resolveEffectiveRsvp({
    explicit: input.explicit,
    hasSeries: input.seriesCommitted,
    committedToSeries: input.seriesCommitted,
  });
}
