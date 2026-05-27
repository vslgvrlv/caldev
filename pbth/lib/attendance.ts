// Карта явки: группирует участников события по ответу на приглашение.
// Язык капитана: Идут / Молчат / Не идут. Внутренние статусы RSVP сюда не протекают.

export type AttendanceRsvp = 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';

export interface AttendanceGroups<T> {
  /** CONFIRMED — идут */
  going: T[];
  /** UNANSWERED + PENDING — молчат (не дали ответа) */
  silent: T[];
  /** DECLINED — не идут */
  notGoing: T[];
  counts: { going: number; silent: number; notGoing: number; total: number };
}

/**
 * Раскладывает участников на 3 человекочитаемые группы.
 * PENDING и UNANSWERED считаются "молчат" — капитану важно, что реального
 * ответа нет, а не внутреннее различие этих статусов.
 */
export function groupAttendance<T extends { rsvpStatus: AttendanceRsvp }>(
  members: T[]
): AttendanceGroups<T> {
  const going: T[] = [];
  const silent: T[] = [];
  const notGoing: T[] = [];

  for (const member of members) {
    if (member.rsvpStatus === 'CONFIRMED') going.push(member);
    else if (member.rsvpStatus === 'DECLINED') notGoing.push(member);
    else silent.push(member); // UNANSWERED | PENDING
  }

  return {
    going,
    silent,
    notGoing,
    counts: {
      going: going.length,
      silent: silent.length,
      notGoing: notGoing.length,
      total: members.length,
    },
  };
}
