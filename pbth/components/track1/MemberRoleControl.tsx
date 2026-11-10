import React from 'react';
import { Loader2 } from 'lucide-react';
import { useShell } from '../../shell/context';
import { track1Api } from '../../api/track1';
import { confirmAction, errorText, notify } from '../../lib/notify';
import { roleLabel } from '../../lib/labels';
import { Role, type TeamMember } from '../../types';

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
    if (busy || next === current) return;
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
    <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
      <div className="text-white font-semibold mb-1">Роль в команде</div>
      <div className="text-xs text-pb-subtext mb-3">{HINTS[current] ?? ''}</div>
      <div className={`grid gap-2 ${choices.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {choices.map((choice) => (
          <button
            key={choice}
            disabled={busy !== null}
            aria-pressed={choice === current}
            onClick={() => void change(choice)}
            className={`py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 ${
              choice === current ? 'bg-pb-primary text-pb-background' : 'bg-white/5 hover:bg-white/10 text-white'
            }`}
          >
            {busy === choice && <Loader2 size={14} className="animate-spin" />}
            {roleLabel(choice)}
          </button>
        ))}
      </div>
    </div>
  );
};
