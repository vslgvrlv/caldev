import React from 'react';
import { useLocation } from 'react-router-dom';

// Перехват ошибок экрана. Без него любая ошибка отрисовки (или кусок кода,
// которого нет после выката) давала белый экран без выхода. Теперь — понятный
// текст и кнопка «Обновить». Переход на другой адрес снимает ошибку.

type Props = { children: React.ReactNode; resetKey: string };
type State = { error: Error | null };

class Boundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Screen crashed', error, info?.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
        <div className="text-center max-w-sm">
          <div className="text-xl font-bold mb-3">Экран не открылся</div>
          <p className="text-pb-subtext mb-6">
            Что-то пошло не так. Обычно помогает обновить страницу — данные на месте.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold"
          >
            Обновить
          </button>
        </div>
      </div>
    );
  }
}

export const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  return <Boundary resetKey={location.pathname}>{children}</Boundary>;
};
