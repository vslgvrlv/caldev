import React from 'react';
import type { JoinRequest } from '../../api/track1';
import { nextEventLines, requestSentText } from '../../lib/invite-copy';
import { Glass, Icon, Row } from '../../ui';
import { InviteHero } from './InviteFrame';
import './invite-frame.css';

// Состояние заявки на вступление: «у капитана» с ближайшим событием или отказ
// словами. Рисуется внутри каркаса приглашения (`InviteFrame`), на экране
// «нет команды». Без состава и денег.

export const JoinRequestStatusCard: React.FC<{ request: JoinRequest }> = ({ request }) => {
  const { team, status } = request;
  if (status === 'DECLINED' || status === 'CANCELLED') {
    return (
      <InviteHero team={team} title={status === 'DECLINED' ? 'Заявку отклонили' : 'Заявка отменена'}>
        {`Команда «${team.name}». Если это ошибка — напиши капитану, пусть пришлёт ссылку ещё раз.`}
      </InviteHero>
    );
  }
  if (status === 'APPROVED') {
    return (
      <InviteHero team={team} title="Тебя приняли">
        {`Ты в команде «${team.name}».`}
      </InviteHero>
    );
  }
  const event = nextEventLines(request.nextEvent);
  return (
    <>
      <InviteHero team={team} checked title="Заявка у капитана">
        Капитану пришло сообщение в Telegram. Как только он примет заявку, откроется команда.
      </InviteHero>
      <Glass layer={2} className="pbth-invite__facts">
        <Row lead={<Icon name="clock" size={24} />} title={team.name} sub={requestSentText(request.createdAt)} />
        {event ? <Row lead={<Icon name="calendar" size={24} />} title={event.when} sub={event.details || undefined} /> : null}
      </Glass>
    </>
  );
};
