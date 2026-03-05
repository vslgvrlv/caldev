import React from 'react';
import { ViewState } from '../types';
import { Home, Calendar, Users, User, Wallet } from 'lucide-react';

interface BottomNavProps {
  currentView: ViewState;
  onChangeView: (view: ViewState) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentView, onChangeView }) => {
  const NavItem = ({ view, icon: Icon, label }: { view: ViewState; icon: any; label: string }) => {
    const isActive = currentView === view;
    return (
      <button 
        onClick={() => onChangeView(view)}
        className={`flex flex-col items-center justify-center w-full space-y-1 ${isActive ? 'text-pb-primary' : 'text-pb-subtext'} active:scale-95 transition-transform`}
      >
        <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
        <span className="text-[10px] font-medium">{label}</span>
      </button>
    );
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-pb-background/90 backdrop-blur-xl border-t border-white/10 pb-safe pt-2 px-2 z-40 h-[85px]">
      <div className="max-w-md mx-auto h-full grid grid-cols-5 items-start pt-2">
        <NavItem view="DASHBOARD" icon={Home} label="Главная" />
        <NavItem view="CALENDAR" icon={Calendar} label="Календарь" />
        <NavItem view="FINANCE" icon={Wallet} label="Казна" />
        <NavItem view="TEAM" icon={Users} label="Команда" />
        <NavItem view="PROFILE" icon={User} label="Профиль" />
      </div>
    </div>
  );
};