import React from 'react';
import { TeamMember, Role, PlayerStatus } from '../types';
import { ROLE_LABELS, STATUS_LABELS, STATUS_COLORS } from '../constants';
import { Phone, Shield, MoreVertical } from 'lucide-react';

interface TeamMemberCardProps {
  member: TeamMember;
  isViewerAdmin: boolean;
  onClick?: () => void;
}

export const TeamMemberCard: React.FC<TeamMemberCardProps> = ({ member, isViewerAdmin, onClick }) => {
  const isLeader = member.role === Role.ADMIN || member.role === Role.CAPTAIN;
  
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      className={`flex items-center justify-between p-3 mb-2 bg-pb-surface rounded-xl border border-white/5 active:bg-white/5 transition-colors ${onClick ? 'cursor-pointer hover:border-pb-primary/50' : ''}`}
    >
      <div className="flex items-center space-x-3 overflow-hidden">
        {/* Avatar */}
        <div className={`relative w-12 h-12 rounded-full p-[2px] ${isLeader ? 'bg-gradient-to-tr from-pb-primary to-blue-500' : 'bg-white/10'}`}>
          <img 
            src={member.avatar || `https://ui-avatars.com/api/?name=${member.name}&background=1E1E2E&color=fff`} 
            alt={member.name}
            className="w-full h-full rounded-full object-cover border-2 border-pb-background"
          />
          {/* Status Dot */}
          <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-pb-background ${STATUS_COLORS[member.status]}`}></div>
        </div>

        {/* Info */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-white truncate text-sm">{member.name}</span>
            {isLeader && <Shield size={12} className="text-pb-primary shrink-0" fill="currentColor" />}
          </div>
          <div className="flex items-center space-x-2">
             <span className="text-xs text-pb-primary font-mono truncate">@{member.nickname}</span>
             <span className="text-[10px] text-pb-subtext px-1.5 py-0.5 bg-white/5 rounded">
                {STATUS_LABELS[member.status]}
             </span>
             <span className="text-[10px] text-pb-subtext px-1.5 py-0.5 bg-white/5 rounded">
                {ROLE_LABELS[member.role]}
             </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center space-x-1 pl-2">
        {member.phone && (
          <a
            href={`tel:${member.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="p-2 text-pb-subtext hover:text-pb-primary transition-colors"
          >
            <Phone size={18} />
          </a>
        )}
        {isViewerAdmin && (
          <button
            onClick={(e) => e.stopPropagation()}
            className="p-2 text-pb-subtext hover:text-white transition-colors"
          >
            <MoreVertical size={18} />
          </button>
        )}
      </div>
    </div>
  );
};
