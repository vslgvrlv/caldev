import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '../../shell/context';
import { platformApi, type JournalItem } from '../../api/track3';
import { groupByDay, timeLabel } from '../../components/track3/format';
import { errorText } from '../../lib/notify';
import { teamCodeOf, teamPath } from '../../lib/team-url';
import { Glass, Icon, Screen, ScreenBar, TeamMark, teamPaint } from '../../ui';
import './journal.css';

// Журнал команды `/t/:team/journal` — капитану: кто, что и когда сделал.
// Действия владельца платформы помечены (решение Василия 10.11.2026, п. 11).
export const TeamJournalView: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const teamId = shell.team?.id ?? null;
  const [items, setItems] = React.useState<JournalItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    platformApi
      .journal(teamId)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, 'Журнал не загрузился. Проверь связь и попробуй ещё раз.'));
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const team = shell.team;
  const goBack = () => {
    if (team) navigate(teamPath(shell.teamCode || teamCodeOf({ teamId: team.id, shortCode: team.shortCode }), 'roster'));
  };

  return (
    <Screen paints={team ? [teamPaint(team.id)] : undefined}>
      <ScreenBar
        onBack={goBack}
        mark={team ? <TeamMark teamId={team.id} name={team.name} code={team.shortCode} size={32} /> : undefined}
        title="Журнал команды"
        subtitle={team?.name}
      />
      <p className="pbth-journal__lead">Последние действия в команде: кто, что и когда.</p>

      {error ? (
        <Glass className="pbth-rempty">
          <span className="pbth-iconlead ui-glass2">
            <Icon name="lock" />
          </span>
          <div className="pbth-muted">{error}</div>
        </Glass>
      ) : items === null ? (
        <Glass className="pbth-pad">
          <div className="ui-skeleton" style={{ height: 160 }} aria-label="Загружаю журнал" />
        </Glass>
      ) : items.length === 0 ? (
        <Glass className="pbth-rempty">
          <span className="pbth-iconlead ui-glass2">
            <Icon name="history" />
          </span>
          <h3 className="pbth-rempty__title">Пока пусто</h3>
          <div className="pbth-muted">Здесь появятся события, ответы, оплаты и приглашения.</div>
        </Glass>
      ) : (
        <Glass className="pbth-team__panel">
          {groupByDay(items).map((group) => (
            <section key={group.day}>
              <div className="pbth-team__group">{group.day}</div>
              {group.items.map((item) => (
                <div key={item.id} className="pbth-jrow">
                  <div className="pbth-jrow__main">
                    <div className="pbth-jrow__who">{item.actorName}</div>
                    <div className="pbth-jrow__text">{item.text}</div>
                    {item.byOwner && (
                      <div className="pbth-jrow__owner">
                        <Icon name="shield-check" size={14} />
                        владелец платформы
                      </div>
                    )}
                  </div>
                  <div className="pbth-small">{timeLabel(item.at)}</div>
                </div>
              ))}
            </section>
          ))}
        </Glass>
      )}
    </Screen>
  );
};
