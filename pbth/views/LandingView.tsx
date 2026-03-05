import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Users, Wallet, Shield, CheckCircle, ChevronRight, Menu, X } from 'lucide-react';

export const LandingView: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-pb-background text-white font-sans selection:bg-pb-primary selection:text-pb-background overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed w-full z-50 bg-pb-background/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-tr from-pb-primary to-blue-500 rounded-xl flex items-center justify-center shadow-[0_0_24px_rgba(0,230,118,0.45)]">
                <Shield size={24} className="text-white" strokeWidth={2.5} />
              </div>
              <span className="text-xl font-black tracking-tight">PaintBall <span className="text-pb-primary">Hub</span></span>
            </div>
            
            {/* Desktop Nav */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-sm font-medium text-pb-subtext hover:text-white transition-colors duration-200">Возможности</a>
              <a href="#how-it-works" className="text-sm font-medium text-pb-subtext hover:text-white transition-colors duration-200">Как это работает</a>
              <a href="#pricing" className="text-sm font-medium text-pb-subtext hover:text-white transition-colors duration-200">Тарифы</a>
              <Link to="/login" className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-full text-sm font-bold transition-all duration-200 hover:shadow-[0_0_18px_rgba(255,255,255,0.12)]">
                Войти
              </Link>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center">
              <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-pb-subtext hover:text-white">
                {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        {isMenuOpen && (
          <div className="md:hidden bg-pb-surface border-b border-white/5">
            <div className="px-4 pt-2 pb-6 space-y-4 flex flex-col">
              <a href="#features" onClick={() => setIsMenuOpen(false)} className="block px-3 py-2 text-base font-medium text-pb-subtext hover:text-white">Возможности</a>
              <a href="#how-it-works" onClick={() => setIsMenuOpen(false)} className="block px-3 py-2 text-base font-medium text-pb-subtext hover:text-white">Как это работает</a>
              <a href="#pricing" onClick={() => setIsMenuOpen(false)} className="block px-3 py-2 text-base font-medium text-pb-subtext hover:text-white">Тарифы</a>
              <Link to="/login" onClick={() => setIsMenuOpen(false)} className="block w-full text-center bg-pb-primary text-pb-background px-5 py-3 rounded-xl text-base font-bold mt-4">
                Войти через Telegram
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-44 lg:pb-32 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 z-0">
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% -5%, rgba(0,230,118,0.30) 0%, rgba(0,230,118,0.08) 25%, rgba(15,15,15,0) 55%), radial-gradient(circle at 15% 35%, rgba(38,109,255,0.20) 0%, rgba(15,15,15,0) 40%), radial-gradient(circle at 85% 30%, rgba(0,230,118,0.12) 0%, rgba(15,15,15,0) 35%), linear-gradient(180deg, #090b0f 0%, #0c0f14 40%, #0f0f0f 100%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-30 bg-cover bg-center mix-blend-soft-light"
            style={{
              backgroundImage: 'url("https://images.unsplash.com/photo-1552083974-186346191183?q=80&w=2070&auto=format&fit=crop")',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-pb-background/55 to-pb-background" />
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-[28rem] h-[18rem] bg-pb-primary/25 rounded-full blur-[100px] pointer-events-none" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="relative inline-flex items-center gap-2 bg-white/5 border border-white/15 rounded-full px-4 py-1.5 mb-8 shadow-[0_8px_24px_rgba(0,0,0,0.35)] animate-[pulse_3.4s_ease-in-out_infinite] motion-reduce:animate-none overflow-hidden">
            <span className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[spin_4.6s_linear_infinite] motion-reduce:animate-none" />
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-pb-primary opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-pb-primary" />
            </span>
            <span className="text-xs font-semibold text-pb-subtext uppercase tracking-wider">Открытый бета-тест</span>
          </div>
          <h1 className="text-[58px] sm:text-7xl md:text-8xl font-black tracking-tight mb-6 leading-[0.98]">
            <span className="block text-white">Управляй командой.</span>
            <span
              className="block mt-2"
              style={{
                backgroundImage: 'linear-gradient(90deg, #00E676 0%, #00D69D 35%, #2E8CFF 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: '#2E8CFF',
              }}
            >
              Побеждай на поле.
            </span>
          </h1>
          <p className="mt-4 text-xl md:text-2xl text-pb-subtext max-w-3xl mx-auto mb-10">
            Единый хаб для капитанов и игроков. Забудьте про 10 разных чатов — расписание, финансы и состав теперь всегда под рукой.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <Link to="/login" className="w-full sm:w-auto bg-[#24A1DE] hover:bg-[#208bbf] text-white px-8 py-4 rounded-2xl text-lg font-bold transition-all duration-300 active:scale-95 hover:-translate-y-0.5 shadow-lg shadow-[#24A1DE]/20 hover:shadow-[0_0_30px_rgba(36,161,222,0.35)] flex items-center justify-center space-x-2">
              <SendIcon className="w-5 h-5" />
              <span>Войти через Telegram</span>
            </Link>
            <a href="#features" className="w-full sm:w-auto bg-white/5 hover:bg-white/10 border border-white/10 text-white px-8 py-4 rounded-2xl text-lg font-bold transition-all duration-300 hover:-translate-y-0.5 flex items-center justify-center space-x-2">
              <span>Узнать больше</span>
              <ChevronRight size={20} />
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-gradient-to-b from-pb-surface/35 to-pb-background border-y border-white/5 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-black mb-4">Всё, что нужно для победы</h2>
            <p className="text-pb-subtext text-lg">Мы собрали лучшие инструменты для администрирования пейнтбольных команд, чтобы вы могли сфокусироваться на игре.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<CalendarDays size={32} className="text-pb-primary" />}
              title="Синхронизированный календарь"
              description="Все тренировки, турниры и сборы в одном месте. Интеграция с вашим личным календарем (ICS) в один клик."
            />
            <FeatureCard 
              icon={<Users size={32} className="text-blue-500" />}
              title="Управление составом (RSVP)"
              description="Больше никаких перекличек в чатах. Игроки отмечают присутствие одной кнопкой, а капитан видит точный состав."
            />
            <FeatureCard 
              icon={<Wallet size={32} className="text-yellow-500" />}
              title="Прозрачные финансы"
              description="Удобная форма для сбора взносов, контроль бюджета команды и история всех транзакций для каждого игрока."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 relative bg-pb-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black mb-4">Как это работает?</h2>
            <p className="text-pb-subtext text-lg">Начать использовать платформу проще простого.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            <StepCard 
              number="01"
              title="Авторизация"
              description="Войдите через Telegram за пару секунд. Никаких паролей и долгих регистраций."
            />
            <StepCard 
              number="02"
              title="Создание команды"
              description="Капитан создает профиль команды и отправляет инвайт-ссылку игрокам."
            />
            <StepCard 
              number="03"
              title="Полный контроль"
              description="Добавляйте события, собирайте взносы и отслеживайте статистику посещений."
            />
          </div>
        </div>
      </section>

      {/* Pricing Placeholder */}
      <section id="pricing" className="py-24 bg-gradient-to-b from-pb-surface/35 to-pb-background border-y border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-black mb-4">Простые тарифы</h2>
            <p className="text-pb-subtext text-lg">Выберите план, который подходит вашей команде.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Free Tier */}
            <div className="bg-pb-background border border-white/10 rounded-3xl p-8 relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_20px_45px_rgba(0,0,0,0.42)]">
              <h3 className="text-2xl font-bold mb-2">Старт</h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-black">Бесплатно</span>
              </div>
              <p className="text-pb-subtext mb-8">Идеально для небольших команд и миксов выходного дня.</p>
              <ul className="space-y-4 mb-8">
                <PricingFeature text="До 10 игроков в команде" />
                <PricingFeature text="Базовый календарь событий" />
                <PricingFeature text="RSVP система" />
              </ul>
              <Link to="/login" className="block w-full bg-white/10 hover:bg-white/20 text-white font-bold py-4 rounded-xl transition-all duration-300 text-center hover:shadow-[0_0_16px_rgba(255,255,255,0.1)]">
                Начать бесплатно
              </Link>
            </div>

            {/* Pro Tier */}
            <div className="bg-[#1f2138] border border-pb-primary/40 rounded-3xl p-8 relative overflow-hidden shadow-[0_0_30px_rgba(0,230,118,0.10)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_55px_rgba(0,230,118,0.22)]">
              <div className="absolute top-0 right-0 bg-pb-primary text-pb-background text-xs font-black px-3 py-1 rounded-bl-lg uppercase tracking-wider">
                Популярный
              </div>
              <h3 className="text-2xl font-bold mb-2 text-pb-primary">Pro Команда</h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-black">Скоро</span>
              </div>
              <p className="text-pb-subtext mb-8">Для турнирных команд с серьезным подходом к тренировкам.</p>
              <ul className="space-y-4 mb-8">
                <PricingFeature text="Неограниченное число игроков" />
                <PricingFeature text="Финансовый модуль и взносы" />
                <PricingFeature text="Детальная статистика посещений" />
                <PricingFeature text="Экспорт календаря (ICS)" />
              </ul>
              <Link to="/support" className="block w-full bg-pb-primary hover:bg-pb-secondary text-pb-background font-bold py-4 rounded-xl transition-all duration-300 shadow-[0_0_20px_rgba(0,230,118,0.32)] hover:shadow-[0_0_30px_rgba(0,230,118,0.45)] text-center">
                Оставить заявку
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
          <div className="flex items-center space-x-2 mb-4 md:mb-0">
            <Shield size={20} className="text-pb-primary" />
            <span className="font-bold">PaintBall Hub &copy; {new Date().getFullYear()}</span>
          </div>
          <div className="flex space-x-6 text-sm text-pb-subtext">
            <Link to="/privacy" className="hover:text-white transition-colors">Политика конфиденциальности</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Условия использования</Link>
            <Link to="/support" className="hover:text-white transition-colors">Поддержка</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) => (
  <div className="group bg-gradient-to-b from-white/[0.03] to-transparent border border-white/5 p-8 rounded-3xl hover:border-white/15 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
    <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-6 transition-transform duration-300 group-hover:scale-105">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-pb-subtext leading-relaxed">{description}</p>
  </div>
);

const StepCard = ({ number, title, description }: { number: string, title: string, description: string }) => (
  <div className="group relative z-10 flex flex-col items-center text-center">
    <div className="w-24 h-24 bg-transparent border-2 border-white/85 rounded-full flex items-center justify-center mb-6 transition-all duration-300 group-hover:border-pb-primary/70 group-hover:shadow-[0_0_24px_rgba(0,230,118,0.28)]">
      <span className="text-4xl font-black text-white transition-colors duration-300 group-hover:text-pb-primary">{number}</span>
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-pb-subtext">{description}</p>
  </div>
);

const PricingFeature = ({ text }: { text: string }) => (
  <li className="flex items-center space-x-3">
    <CheckCircle size={20} className="text-pb-primary shrink-0" />
    <span className="text-pb-subtext">{text}</span>
  </li>
);

// Simple Telegram Send Icon SVG
const SendIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
