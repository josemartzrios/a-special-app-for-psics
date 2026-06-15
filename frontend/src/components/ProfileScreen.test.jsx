import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileScreen from './ProfileScreen';

vi.mock('../api', () => ({
  getMyProfile: vi.fn(),
  getBillingStatus: vi.fn(),
}));

vi.mock('./UpdateCardModal', () => ({
  default: ({ open }) => open ? <div data-testid="update-card-modal" /> : null,
}));

vi.mock('./ProfilePasswordField', () => ({
  default: () => <div data-testid="profile-password-field" />,
}));

import { getMyProfile, getBillingStatus } from '../api';

const mockProfile = {
  id: 'uuid-1',
  name: 'Dr. Test',
  email: 'test@example.com',
  cedula_profesional: '1234567',
};

const mockBillingActive = {
  status: 'active',
  current_period_end: '2026-06-28T00:00:00Z',
  cancel_at_period_end: false,
  payment_method: { brand: 'visa', last4: '4242' },
};

describe('ProfileScreen', () => {
  beforeEach(() => {
    getMyProfile.mockResolvedValue(mockProfile);
    getBillingStatus.mockResolvedValue(mockBillingActive);
  });

  it('muestra los datos personales del psicólogo', async () => {
    render(<ProfileScreen />);
    await waitFor(() => {
      expect(screen.getByText('Dr. Test')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
      expect(screen.getByText('1234567')).toBeInTheDocument();
    });
  });

  it('muestra el componente ProfilePasswordField en Card 1', async () => {
    render(<ProfileScreen />);
    await waitFor(() => screen.getByText('Dr. Test'));
    expect(screen.getByTestId('profile-password-field')).toBeInTheDocument();
  });

  it('muestra badge de plan activo y chip de tarjeta', async () => {
    render(<ProfileScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Plan Pro/i)).toBeInTheDocument();
      expect(screen.getByText(/4242/)).toBeInTheDocument();
    });
  });

  it('muestra "No registrada" cuando cédula es null', async () => {
    getMyProfile.mockResolvedValue({ ...mockProfile, cedula_profesional: null });
    render(<ProfileScreen />);
    await waitFor(() => {
      expect(screen.getByText('No registrada')).toBeInTheDocument();
    });
  });

  it('abre el modal al hacer click en "Cambiar tarjeta"', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen />);
    await waitFor(() => screen.getByText(/Cambiar tarjeta/i));
    await user.click(screen.getByText(/Cambiar tarjeta/i));
    expect(screen.getByTestId('update-card-modal')).toBeInTheDocument();
  });

  it('no muestra botón "Cambiar tarjeta" en trial', async () => {
    getBillingStatus.mockResolvedValue({ status: 'trialing', days_remaining: 10 });
    render(<ProfileScreen />);
    await waitFor(() => screen.getByText('Dr. Test'));
    expect(screen.queryByText(/Cambiar tarjeta/i)).not.toBeInTheDocument();
  });

  it('estado courtesy muestra solo badge, sin chip ni botón cambiar tarjeta', async () => {
    getBillingStatus.mockResolvedValue({ status: 'courtesy' });
    render(<ProfileScreen />);
    await waitFor(() => screen.getByText(/Acceso de Cortesía/i));
    expect(screen.queryByText(/4242/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cambiar tarjeta/i)).not.toBeInTheDocument();
  });
});
