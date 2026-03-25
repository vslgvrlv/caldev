type ChargeAudience = "CONFIRMED_ONLY" | "CONFIRMED_AND_PENDING";
type ChargeAmountMode = "UNDISTRIBUTED_SPLIT" | "FIXED_PER_PERSON";
type ChargeParticipant = {
  userId: string;
  role: "CAPTAIN" | "TRAINER" | "PLAYER";
  rsvpStatus: "UNANSWERED" | "PENDING" | "CONFIRMED" | "DECLINED";
  amountDue: number;
};

type EventChargeModalStateParams = {
  participants: ChargeParticipant[];
  audience: ChargeAudience;
  amountMode: ChargeAmountMode;
  undistributedAmount: number;
  fixedAmount: string | number;
};

export function buildEventChargeModalState(params: EventChargeModalStateParams) {
  const eligibleParticipants = params.participants.filter((item) => {
    if (item.role === "CAPTAIN") return false;
    return params.audience === "CONFIRMED_ONLY"
      ? item.rsvpStatus === "CONFIRMED"
      : item.rsvpStatus === "CONFIRMED" || item.rsvpStatus === "PENDING";
  });

  if (eligibleParticipants.length === 0) {
    return {
      eligibleParticipants,
      preview: "Нет подходящих участников для начисления.",
      canSubmit: false,
      blockingReason: "Нет игроков или тренеров с подходящим статусом участия. Сначала отметьте состав события.",
    };
  }

  if (params.amountMode === "FIXED_PER_PERSON") {
    const participantsWithExistingCharges = eligibleParticipants.filter((item) => Number(item.amountDue || 0) > 0);
    const chargeTargets =
      participantsWithExistingCharges.length > 0
        ? eligibleParticipants.filter((item) => Number(item.amountDue || 0) <= 0)
        : eligibleParticipants;

    if (chargeTargets.length === 0) {
      return {
        eligibleParticipants,
        preview: "У всех подходящих участников уже есть начисления.",
        canSubmit: false,
        blockingReason: "У всех подходящих участников уже есть начисления. Для изменения суммы используйте корректировку, а не доначисление.",
      };
    }

    const numericAmount = Number(params.fixedAmount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return {
        eligibleParticipants,
        preview: `Будет начислено ${chargeTargets.length} участникам.`,
        canSubmit: false,
        blockingReason: "Укажите корректную сумму на игрока.",
      };
    }
    return {
      eligibleParticipants,
      preview: `Будет начислено ${chargeTargets.length} участникам по ${numericAmount.toLocaleString("ru-RU")} ₽.`,
      canSubmit: true,
      blockingReason: null,
    };
  }

  const numericAmount = Number(params.undistributedAmount || 0);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return {
      eligibleParticipants,
      preview: "Сейчас по событию нет нераспределенных расходов.",
      canSubmit: false,
      blockingReason: "По событию нет нераспределенных расходов.",
    };
  }

  const totalCents = Math.round(numericAmount * 100);
  const base = Math.floor(totalCents / eligibleParticipants.length);
  const remainder = totalCents - base * eligibleParticipants.length;
  const minShare = base / 100;
  const maxShare = (base + (remainder > 0 ? 1 : 0)) / 100;
  const preview =
    Math.abs(maxShare - minShare) < 0.0001
      ? `Будет начислено ${eligibleParticipants.length} участникам по ${minShare.toLocaleString("ru-RU")} ₽.`
      : `Будет начислено ${eligibleParticipants.length} участникам в диапазоне от ${minShare.toLocaleString(
          "ru-RU"
        )} ₽ до ${maxShare.toLocaleString("ru-RU")} ₽.`;

  return {
    eligibleParticipants,
    preview,
    canSubmit: true,
    blockingReason: null,
  };
}
