import React, { useState } from 'react';
import { Transaction, TransactionType, Role, TeamMember, Team } from '../types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, CheckCircle, Plus } from 'lucide-react';

interface FinanceViewProps {
  team: Team;
  transactions: Transaction[];
  members: TeamMember[];
  currentUserRole: Role;
  onAddTransaction: (t: Omit<Transaction, 'id' | 'date'>) => void;
  onRemindDebtor: (userId: string, userName: string) => Promise<void>;
  onRemindAllDebtors: () => Promise<void>;
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  team,
  transactions,
  members,
  currentUserRole,
  onAddTransaction,
  onRemindDebtor,
  onRemindAllDebtors,
}) => {
  const [activeTab, setActiveTab] = useState<'HISTORY' | 'DEBTS'>('HISTORY');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRemindingAll, setIsRemindingAll] = useState(false);
  const [remindingUserIds, setRemindingUserIds] = useState<Set<string>>(new Set());
  
  // Modal Form State
  const [formType, setFormType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [formAmount, setFormAmount] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formUser, setFormUser] = useState(members[0]?.id || '');

  const isAdmin = currentUserRole === Role.ADMIN || currentUserRole === Role.CAPTAIN;
  
  // Filter debts
  const debtors = members.filter(m => (m.balance || 0) < 0).sort((a, b) => (a.balance || 0) - (b.balance || 0));

  const handleRemindDebtorClick = async (userId: string, userName: string) => {
    setRemindingUserIds((prev) => new Set(prev).add(userId));
    try {
      await onRemindDebtor(userId, userName);
    } finally {
      setRemindingUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleRemindAllClick = async () => {
    setIsRemindingAll(true);
    try {
      await onRemindAllDebtors();
    } finally {
      setIsRemindingAll(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddTransaction({
      type: formType,
      amount: Number(formAmount),
      title: formTitle,
      userId: formType === TransactionType.EXPENSE ? undefined : formUser,
      userName: formType === TransactionType.EXPENSE ? undefined : members.find(m => m.id === formUser)?.name,
      status: 'COMPLETED' // Simplified for demo
    });
    setIsModalOpen(false);
    setFormAmount('');
    setFormTitle('');
  };

  return (
    <div className="pb-24 pt-4 px-4 h-full flex flex-col animate-fade-in relative">
      <h1 className="text-2xl font-bold text-white mb-6">Казна</h1>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-pb-surface to-[#1a1a2e] rounded-3xl p-6 border border-white/5 relative overflow-hidden mb-6 shadow-lg shadow-black/50">
         <div className="absolute top-0 right-0 w-32 h-32 bg-pb-primary/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
         <div className="relative z-10">
            <span className="text-pb-subtext text-xs font-bold uppercase tracking-wider block mb-2">Общий баланс</span>
            <div className="text-4xl font-black text-white mb-2 flex items-baseline">
              {team.budget.toLocaleString('ru-RU')} <span className="text-xl ml-2 text-pb-primary">₽</span>
            </div>
            <div className="flex gap-4">
               <div className="flex items-center text-xs text-pb-subtext">
                  <div className="w-2 h-2 rounded-full bg-pb-primary mr-2"></div> Доступно
               </div>
               {debtors.length > 0 && (
                   <div className="flex items-center text-xs text-pb-danger font-bold">
                      <div className="w-2 h-2 rounded-full bg-pb-danger mr-2"></div> 
                      Долг игроков: {Math.abs(debtors.reduce((acc, m) => acc + (m.balance || 0), 0)).toLocaleString()} ₽
                   </div>
               )}
            </div>
         </div>
      </div>

      {/* Actions (Admin Only) */}
      {isAdmin && (
        <div className="grid grid-cols-2 gap-3 mb-6">
           <button 
             onClick={() => { setFormType(TransactionType.FEE); setIsModalOpen(true); }}
             className="bg-pb-surface hover:bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-center text-sm font-bold text-white transition-all active:scale-[0.98]"
           >
             <DollarSign size={16} className="mr-2 text-pb-warning" /> Создать сбор
           </button>
           <button 
             onClick={() => { setFormType(TransactionType.EXPENSE); setIsModalOpen(true); }}
             className="bg-pb-surface hover:bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-center text-sm font-bold text-white transition-all active:scale-[0.98]"
           >
             <TrendingDown size={16} className="mr-2 text-pb-danger" /> Записать трату
           </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-pb-surface rounded-xl p-1 border border-white/5 mb-4">
        <button 
          onClick={() => setActiveTab('HISTORY')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'HISTORY' ? 'bg-white/10 text-white' : 'text-pb-subtext hover:text-white'}`}
        >
          История
        </button>
        <button 
          onClick={() => setActiveTab('DEBTS')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'DEBTS' ? 'bg-white/10 text-white' : 'text-pb-subtext hover:text-white'}`}
        >
          Должники {debtors.length > 0 && `(${debtors.length})`}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'HISTORY' ? (
           <div className="space-y-3">
             {transactions.length === 0 && <div className="text-center text-pb-subtext py-8 text-sm">История пуста</div>}
             {transactions.map(t => (
               <div key={t.id} className="bg-pb-surface border border-white/5 p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                     <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                       t.type === TransactionType.EXPENSE ? 'bg-pb-danger/10 text-pb-danger' : 
                       t.type === TransactionType.DEPOSIT ? 'bg-pb-primary/10 text-pb-primary' : 'bg-pb-warning/10 text-pb-warning'
                     }`}>
                        {t.type === TransactionType.EXPENSE ? <TrendingDown size={18} /> : 
                         t.type === TransactionType.DEPOSIT ? <TrendingUp size={18} /> : <DollarSign size={18} />}
                     </div>
                     <div>
                        <div className="font-bold text-white text-sm">{t.title}</div>
                        <div className="text-xs text-pb-subtext">
                           {format(t.date, 'd MMM', { locale: ru })} • {t.userName || 'Команда'}
                        </div>
                     </div>
                  </div>
                  <div className={`font-mono font-bold ${
                     t.type === TransactionType.EXPENSE ? 'text-pb-danger' : 'text-pb-primary'
                  }`}>
                     {t.type === TransactionType.EXPENSE ? '-' : '+'}{t.amount} ₽
                  </div>
               </div>
             ))}
           </div>
        ) : (
           <div className="space-y-3">
             {isAdmin && debtors.length > 0 && (
               <button
                 type="button"
                 onClick={handleRemindAllClick}
                 disabled={isRemindingAll}
                 className="w-full bg-pb-surface border border-pb-primary/30 p-3 rounded-xl text-pb-primary font-bold text-sm hover:bg-pb-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
               >
                 {isRemindingAll ? 'Отправляем...' : 'Напомнить всем должникам'}
               </button>
             )}
             {debtors.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-pb-subtext">
                   <CheckCircle size={48} className="text-pb-primary mb-4 opacity-50" />
                   <p>Долгов нет. Все молодцы!</p>
                </div>
             )}
             {debtors.map(m => (
               <div key={m.id} className="bg-pb-surface border border-pb-danger/30 p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                     <img src={m.avatar} className="w-10 h-10 rounded-full bg-white/10" alt={m.name} />
                     <div>
                        <div className="font-bold text-white text-sm">{m.name}</div>
                        <div className="text-xs text-pb-subtext">@{m.nickname}</div>
                     </div>
                  </div>
                  <div className="text-right">
                     <div className="font-mono font-bold text-pb-danger">{m.balance} ₽</div>
                     {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleRemindDebtorClick(m.id, m.name)}
                          disabled={remindingUserIds.has(m.id)}
                          className="text-[10px] text-pb-primary underline mt-1 disabled:opacity-50 disabled:no-underline"
                        >
                          {remindingUserIds.has(m.id) ? 'Отправляем...' : 'Напомнить'}
                        </button>
                     )}
                  </div>
               </div>
             ))}
           </div>
        )}
      </div>

      {/* Transaction Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
             <h3 className="text-lg font-bold text-white mb-4">
               {formType === TransactionType.EXPENSE ? 'Новая трата' : 'Новый сбор'}
             </h3>
             <form onSubmit={handleSubmit} className="space-y-4">
               
               {formType === TransactionType.FEE && (
                 <div>
                    <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Кого касатеся</label>
                    <select 
                      value={formUser}
                      onChange={(e) => setFormUser(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                    >
                      {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                 </div>
               )}

               <div>
                  <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Название</label>
                  <input 
                    type="text" 
                    placeholder={formType === TransactionType.EXPENSE ? "Шары, аренда..." : "Турнир, джерси..."}
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                    required
                  />
               </div>

               <div>
                  <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Сумма (₽)</label>
                  <input 
                    type="number" 
                    placeholder="0"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                    required
                  />
               </div>

               <div className="flex gap-2 pt-2">
                 <button 
                   type="button" 
                   onClick={() => setIsModalOpen(false)}
                   className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                 >
                   Отмена
                 </button>
                 <button 
                   type="submit" 
                   className={`flex-1 py-3 rounded-xl font-bold transition-colors text-white ${formType === TransactionType.EXPENSE ? 'bg-pb-danger' : 'bg-pb-primary text-pb-background'}`}
                 >
                   {formType === TransactionType.EXPENSE ? 'Списать' : 'Начислить'}
                 </button>
               </div>
             </form>
          </div>
        </div>
      )}
    </div>
  );
};
