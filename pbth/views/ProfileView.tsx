import React from 'react';
import { User, Role, TeamContext } from '../types';
import { roleLabel } from '../lib/labels';
import { ProfileIdentities } from '../components/ProfileIdentities';
import { GuideEntrypoint } from '../components/GuideEntrypoint';
import { PushOptIn } from '../components/PushOptIn';
import { ReminderSettings } from '../components/track2/ReminderSettings';
import { Avatar, Button, Glass, Icon, Row, Screen, TeamMark, teamPaint } from '../ui';
import './team/team.css';

interface ProfileViewProps {
  user: User;
  onLogout: () => void | Promise<void>;
  calendarLink: string;
  onCopyLink: () => void;
  onShareLink: () => void;
  onDownloadICS: () => void;
  role: Role | null | undefined;
  /**
   * True when the current user is allowlisted as a platform owner.
   * Плитка «Консоль владельца» — только владельцу платформы.
   */
  canEnterAdmin?: boolean;
  /** Called when the admin-entry card is tapped. */
  onEnterAdmin?: () => void;
  /** Карточки «Ты записан гостем» (слоты чужих команд). */
  guestBookings?: React.ReactNode;
  /** Команды человека: список «Мои команды». Команды, где владелец платформы не состоит, в него не входят. */
  teams?: TeamContext[];
  /** Нажали на команду в списке: открыть её главную. */
  onOpenTeam?: (team: TeamContext) => void;
}

const iconLead = (name: string) => (
  <span className="pbth-iconlead ui-glass2">
    <Icon name={name} />
  </span>
);

const Section: React.FC<{ title: string; aside?: React.ReactNode }> = ({ title, aside }) => (
  <div className="pbth-section">
    <h2 className="pbth-section__title">{title}</h2>
    {aside ? <span className="pbth-muted">{aside}</span> : null}
  </div>
);

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  onLogout,
  calendarLink,
  onCopyLink,
  onShareLink,
  onDownloadICS,
  role,
  canEnterAdmin = false,
  onEnterAdmin,
  guestBookings,
  teams = [],
  onOpenTeam,
}) => {
  const ownTeams = teams.filter((t) => t.via !== 'owner');
  const paints = ownTeams.slice(0, 3).map((t) => teamPaint(t.teamId));

  return (
    <Screen paints={paints.length ? paints : undefined}>
      {/* Редактирования профиля здесь нет: прежняя форма («Редактировать →
          Сохранить», «Новый пароль», кнопка фото) ничего не сохраняла.
          Имя и ник приходят из Telegram при входе. */}
      <div className="pbth-phero">
        <Avatar name={user.name} src={user.avatar} size={96} />
        <h1 className="pbth-phero__name">{user.name}</h1>
        <div className="pbth-phero__nick">@{user.nickname}</div>
        <div className="pbth-small">Имя и ник берутся из Telegram.</div>
      </div>

      {/* Порядок как в макете (14-profile-full): аватар, имя, ник, «Мои команды», дальше настройки. */}
      {ownTeams.length > 0 && (
        <>
          <Section title="Мои команды" aside={ownTeams.length} />
          <Glass className="pbth-team__panel">
            {ownTeams.map((t) => (
              <Row
                key={t.teamId}
                lead={<TeamMark teamId={t.teamId} name={t.teamName} code={t.shortCode} size={40} />}
                title={t.teamName}
                sub={roleLabel(t.role)}
                chevron
                onClick={() => onOpenTeam?.(t)}
              />
            ))}
          </Glass>
        </>
      )}

      {guestBookings}

      <Section title="Уведомления" />
      <Glass className="pbth-team__panel pbth-switchpanel">
        <PushOptIn />
        <ReminderSettings />
      </Glass>

      <Section title="Способы входа" />
      <ProfileIdentities telegramNick={user.telegramUsername || user.nickname} />

      <Glass className="pbth-team__panel" style={{ marginTop: 12 }}>
        <GuideEntrypoint role={role} />
        <Row as="a" href="/support" lead={iconLead('circle-help')} title="Поддержка" chevron />
      </Glass>

      {/* Консоль владельца платформы — только владельцу (трек 3). */}
      {canEnterAdmin && (
        <Glass className="pbth-team__panel" style={{ marginTop: 12 }}>
          <Row
            lead={iconLead('shield')}
            title="Консоль владельца"
            sub="Все команды, заявки на создание, помощь командам"
            chevron
            onClick={() => onEnterAdmin?.()}
          />
        </Glass>
      )}

      <Section title="Интеграция календаря" />
      <Glass className="pbth-team__panel">
        <Row
          lead={iconLead('calendar')}
          title="Твой календарь"
          sub={<span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{calendarLink}</span>}
          trailing={<Button variant="ghost" icon="copy" aria-label="Скопировать ссылку на календарь" onClick={onCopyLink} />}
        />
        <Row lead={iconLead('share-2')} title="Поделиться ссылкой" chevron onClick={onShareLink} />
        <Row lead={iconLead('download')} title="Скачать .ics (файл)" chevron onClick={onDownloadICS} />
      </Glass>
      <p className="pbth-pnote">Подпишись на свой календарь, чтобы видеть события в Google и Apple Calendar.</p>

      <Glass className="pbth-team__panel" style={{ marginTop: 24 }}>
        <Row
          lead={iconLead('log-out')}
          title="Выйти"
          onClick={() => {
            void onLogout();
          }}
        />
      </Glass>
    </Screen>
  );
};
