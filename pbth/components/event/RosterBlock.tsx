import React from 'react';
import { Avatar, Button, Glass, Icon, Row } from '../../ui';
import { rosterHeadline, rosterSub, type Roster, type RosterPerson } from '../../lib/event-view';

type Props = {
  roster: Roster;
  loading: boolean;
  onPerson: (person: RosterPerson) => void;
  /** Игрок без ответа: свободное место становится кнопкой «Иду». */
  onJoin?: () => void;
  onRemindSilent?: () => void;
  reminding?: boolean;
  /** Событие прошло: свободные места не показываются. */
  hideFree?: boolean;
};

const PersonRow: React.FC<{ person: RosterPerson; onPerson: Props['onPerson']; trailing: React.ReactNode }> = ({
  person,
  onPerson,
  trailing,
}) => (
  <Row
    lead={<Avatar name={person.name} src={person.avatar} size={40} />}
    title={person.isSelf ? 'Ты' : person.name}
    sub={rosterSub(person)}
    trailing={trailing}
    onClick={() => onPerson(person)}
  />
);

const Fold: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="glass2" className="pbth-event__fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} />
      </Button>
      {open ? <div className="pbth-event__fold-body">{children}</div> : null}
    </>
  );
};

const GoingTag: React.FC<{ self: boolean }> = ({ self }) => (
  <span className="pbth-event__tag">
    <Icon name="check" size={16} />
    {self ? 'идёшь' : 'идёт'}
  </span>
);

/** «Идут N из M»: точки, идущие плотными строками по пятёркам, молчуны и отказавшиеся свёрнуто. */
export const RosterBlock: React.FC<Props> = ({ roster, loading, onPerson, onJoin, onRemindSilent, reminding, hideFree }) => (
  <Glass layer={1} className="pbth-event__panel" data-testid="event-roster">
    <div className="pbth-event__head">
      <h2 className="pbth-event__h pbth-event__h--nowrap">{rosterHeadline(roster)}</h2>
      <div className="pbth-event__dots" aria-hidden="true">
        {roster.dots.map((group, gi) => (
          <span key={gi} className="pbth-event__dotgroup">
            {group.map((on, i) => (
              <span key={i} className={`pbth-event__dot${on ? ' pbth-event__dot--on' : ''}`} />
            ))}
          </span>
        ))}
      </div>
    </div>

    {loading ? <div className="pbth-event__muted">Загружаем состав…</div> : null}
    {!loading && roster.goingCount === 0 ? <div className="pbth-event__muted">Пока никто не подтвердил.</div> : null}
    {!loading && roster.goingCount > 0 && roster.empty ? (
      <div className="pbth-event__muted">Список имён сейчас недоступен.</div>
    ) : null}

    {!loading && roster.staff.length > 0 ? (
      <div>
        <div className="pbth-event__group">Штаб</div>
        {roster.staff.map((p) => (
          <PersonRow key={p.userId} person={p} onPerson={onPerson} trailing={<GoingTag self={p.isSelf} />} />
        ))}
      </div>
    ) : null}

    {!loading
      ? roster.fives.map((five) => (
          <div key={five.title}>
            <div className="pbth-event__group">{five.title}</div>
            {five.people.map((p) => (
              <PersonRow key={p.userId} person={p} onPerson={onPerson} trailing={<GoingTag self={p.isSelf} />} />
            ))}
            {Array.from({ length: hideFree ? 0 : five.free }, (_, i) => (
              <Row
                key={`free-${i}`}
                lead={
                  <span className="pbth-event__free">
                    <Icon name="plus" size={20} />
                  </span>
                }
                title={<span className="pbth-event__free-title">Свободно</span>}
                {...(onJoin ? { onClick: onJoin } : {})}
              />
            ))}
          </div>
        ))
      : null}

    {!loading && roster.silent.length > 0 ? (
      <Fold label={`Не ответили · ${roster.silent.length}`}>
        {onRemindSilent ? (
          <Button variant="ghost" size="sm" icon="bell" disabled={reminding} onClick={onRemindSilent}>
            {reminding ? 'Отправляем…' : `Напомнить (${roster.silent.length})`}
          </Button>
        ) : null}
        {roster.silent.map((p) => (
          <PersonRow
            key={p.userId}
            person={p}
            onPerson={onPerson}
            trailing={p.rsvpStatus === 'PENDING' ? <span className="pbth-event__tag pbth-event__tag--muted">думает</span> : null}
          />
        ))}
      </Fold>
    ) : null}

    {!loading && roster.declined.length > 0 ? (
      <Fold label={`Не идут · ${roster.declined.length}`}>
        {roster.declined.map((p) => (
          <PersonRow key={p.userId} person={p} onPerson={onPerson} trailing={null} />
        ))}
      </Fold>
    ) : null}
  </Glass>
);
