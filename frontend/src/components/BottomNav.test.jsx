// frontend/src/components/BottomNav.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BottomNav from './BottomNav';

describe('BottomNav', () => {
  it('renders Inicio and Agenda tabs', () => {
    render(<BottomNav activeSection="patients" onSectionChange={() => {}} />);
    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.getByText('Agenda')).toBeInTheDocument();
  });

  it('highlights active section', () => {
    render(<BottomNav activeSection="agenda" onSectionChange={() => {}} />);
    const agendaBtn = screen.getByText('Agenda').closest('button');
    expect(agendaBtn.className).toContain('text-[#5a9e8a]');
  });

  it('calls onSectionChange when tab is clicked', () => {
    const onChange = vi.fn();
    render(<BottomNav activeSection="patients" onSectionChange={onChange} />);
    fireEvent.click(screen.getByText('Agenda').closest('button'));
    expect(onChange).toHaveBeenCalledWith('agenda');
  });
});
