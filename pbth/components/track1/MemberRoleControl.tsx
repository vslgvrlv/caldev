import React from 'react';
import { useShell } from '../../shell/context';
import { track1Api } from '../../api/track1';
import { confirmAction, errorText, notify } from '../../lib/notify';
import { roleLabel } from '../../lib/labels';
import { Role, type TeamMember } from '../../types';
import { Button, Glass, Icon, Row, Sheet } from '../../ui';
import '../../views/team/team.css';

// Роль участника в карточке игрока (трек 1, решение Василия 10.11.2026, п. 12).
// Тренером делает и возвращает в игроки капитан. Капитаном назначает только
// владелец платформы (caldev#131) — сервер проверяет это сам, здесь кнопка
// «Капитан» просто не показывается остальным.

type Choice = 'PLAYER' | 'TRAINER' | 'CAPTAIN';

const HINTS: Record<Choice, string> = {
  PLAYER: 'Участник команды.',
  TRAINER: 'Помогает капитану: принимает заявки в команду.',
  CAPTAIN: 'Управляет командой целиком.',
};

export const MemberRoleControl: React.FC<{ member: TeamMember }> = ({ member }) => {
  const shell = useShell();
  const [busy, setBusy] = React.useState<Choice | null>(null);
  const [open, setOpen] = React.useState(false);
  const team = shell.team;
  if (!team || !member.membershipId) return null;
  const viewerIsCaptain = team.role === Role.CAPTAIN || team.role === Role.ADMIN;
  if (!viewerIsCaptain) return null;
  if (shell.user?.id === member.id) return null;
  // Чужого капитана меняет только владелец платформы.
  const ownerMode = shell.canEnterAdmin;
  if (member.role === Role.CAPTAIN && !ownerMode) return null;

  const choices: Choice[] = ownerMode ? ['PLAYER', 'TRAINER', 'CAPTAIN'] : ['PLAYER', 'TRAINER'];
  const current = String(member.role) as Choice;

  const change = async (next: Choice) => {
    if (busy || next === current) {
      setOpen(false);
      return;
    }
    // Окно подтверждения открывается после закрытия шторки, а не поверх неё.
    setOpen(false);
    const ok = await confirmAction(`${member.name}: ${roleLabel(current).toLowerCase()} → ${roleLabel(next).toLowerCase()}?`, {
      confirmLabel: 'Сменить роль',
    });
    if (!ok) return;
    setBusy(next);
    try {
      await track1Api.setMemberRole(team.id, member.membershipId!, next);
      await shell.reload();
      notify.success(`${member.name} теперь ${roleLabel(next).toLowerCase()}`);
    } catch (error) {
      notify.error(errorText(error, 'Роль не сменилась. Попробуй ещё раз.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Glass className="pbth-team__panel">
        <Row
          lead={<span className="pbth-iconlead ui-glass2"><Icon name="shield-check" /></span>}
          title="Роль в команде"
          sub={HINTS[current] ?? ''}
          trailing={<span>{roleLabel(current)}</span>}
          chevron
          onClick={() => setOpen(true)}
          disabled={busy !== null}
        />
      </Glass>
      <Sheet open={open} onClose={() => setOpen(false)} title="Роль в команде" subtitle={member.name}>
        <div className="pbth-sheetlist">
          {choices.map((choice) => (
            <Button
              key={choice}
              variant={choice === current ? 'light' : 'glass2'}
              block
              icon={choice === current ? 'check' : undefined}
              aria-pressed={choice === current}
              disabled={busy !== null}
              onClick={() => void change(choice)}
            >
              {roleLabel(choice)}
            </Button>
          ))}
          <div className="pbth-small">{HINTS[current] ?? ''}</div>
        </div>
      </Sheet>
    </>
  );
};
