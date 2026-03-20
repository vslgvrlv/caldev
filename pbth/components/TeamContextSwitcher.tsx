import React from 'react';
import { Role, TeamContext } from '../types';
import { buildFinanceFilterOptions } from '../lib/finance-view-model';

interface TeamContextSwitcherProps {
  teams: TeamContext[];
  selectedTeamId: string;
  currentUserRole: Role;
  disabled?: boolean;
  onChange: (teamId: string) => void;
}

export const TeamContextSwitcher: React.FC<TeamContextSwitcherProps> = ({
  teams,
  selectedTeamId,
  currentUserRole,
  disabled = false,
  onChange,
}) => {
  const options = buildFinanceFilterOptions({
    teams,
    currentUserRole,
    selectedTeamId,
  });
  const activeOption = options.find((option) => option.isActive) || options[0];

  if (!activeOption) return null;

  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-pb-subtext">
        Команда
      </span>
      <select
        value={activeOption.value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-pb-surface px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-pb-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.role ? `${option.label} · ${option.role}` : option.label}
          </option>
        ))}
      </select>
    </label>
  );
};
