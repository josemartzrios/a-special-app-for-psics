import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  createSetupIntent: vi.fn(),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: vi.fn(),
  useElements: vi.fn(),
}));

import { createSetupIntent } from '../api';
import { useStripe, useElements } from '@stripe/react-stripe-js';
import UpdateCardModal from './UpdateCardModal';

const mockStripe = {
  confirmSetup: vi.fn(),
};
const mockElements = {};

describe('UpdateCardModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStripe.mockReturnValue(mockStripe);
    useElements.mockReturnValue(mockElements);
  });

  it('no renderiza nada cuando open=false', () => {
    const { container } = render(<UpdateCardModal open={false} onClose={() => {}} onSuccess={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('llama createSetupIntent al abrirse', async () => {
    createSetupIntent.mockResolvedValue({ client_secret: 'seti_test_secret' });
    render(<UpdateCardModal open={true} onClose={() => {}} onSuccess={() => {}} />);
    await waitFor(() => {
      expect(createSetupIntent).toHaveBeenCalledTimes(1);
    });
  });

  it('muestra spinner mientras carga el secret', () => {
    createSetupIntent.mockReturnValue(new Promise(() => {})); // never resolves
    render(<UpdateCardModal open={true} onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renderiza PaymentElement cuando tiene client_secret', async () => {
    createSetupIntent.mockResolvedValue({ client_secret: 'seti_test_secret' });
    render(<UpdateCardModal open={true} onClose={() => {}} onSuccess={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    });
  });

  it('llama stripe.confirmSetup y onSuccess en submit exitoso', async () => {
    createSetupIntent.mockResolvedValue({ client_secret: 'seti_test_secret' });
    mockStripe.confirmSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });

    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<UpdateCardModal open={true} onClose={onSuccess} onSuccess={onSuccess} />);

    await waitFor(() => screen.getByTestId('payment-element'));
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(mockStripe.confirmSetup).toHaveBeenCalledWith(
        expect.objectContaining({ elements: mockElements })
      );
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('stripe.confirmSetup con error muestra mensaje inline', async () => {
    createSetupIntent.mockResolvedValue({ client_secret: 'seti_test_secret' });
    mockStripe.confirmSetup.mockResolvedValue({ error: { message: 'Tu tarjeta fue rechazada' } });

    const user = userEvent.setup();
    render(<UpdateCardModal open={true} onClose={() => {}} onSuccess={() => {}} />);

    await waitFor(() => screen.getByTestId('payment-element'));
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(screen.getByText(/rechazada/i)).toBeInTheDocument();
    });
  });

  it('cierra con Escape', async () => {
    createSetupIntent.mockResolvedValue({ client_secret: 'seti_test_secret' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<UpdateCardModal open={true} onClose={onClose} onSuccess={() => {}} />);

    await waitFor(() => screen.getByTestId('payment-element'));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
