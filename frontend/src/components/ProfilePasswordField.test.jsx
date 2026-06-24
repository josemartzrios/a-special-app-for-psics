import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  changePassword: vi.fn(),
}));

import { changePassword } from '../api';
import ProfilePasswordField from './ProfilePasswordField';

describe('ProfilePasswordField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra punto medio y lápiz en estado idle', () => {
    render(<ProfilePasswordField />);
    expect(screen.getByText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /editar contraseña/i })).toBeInTheDocument();
  });

  it('expande los tres inputs al hacer click en el lápiz', async () => {
    const user = userEvent.setup();
    render(<ProfilePasswordField />);
    await user.click(screen.getByRole('button', { name: /editar contraseña/i }));
    expect(screen.getByPlaceholderText(/contraseña actual/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nueva contraseña')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirmar nueva contraseña')).toBeInTheDocument();
  });

  it('Guardar llama changePassword con los valores correctos y pasa a success', async () => {
    const user = userEvent.setup();
    changePassword.mockResolvedValue({});
    render(<ProfilePasswordField />);

    await user.click(screen.getByRole('button', { name: /editar contraseña/i }));
    await user.type(screen.getByPlaceholderText(/contraseña actual/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Nueva contraseña'), 'NewPass456!');
    await user.type(screen.getByPlaceholderText('Confirmar nueva contraseña'), 'NewPass456!');
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('OldPass123!', 'NewPass456!');
    });
    await waitFor(() => {
      expect(screen.getByText(/contraseña actualizada/i)).toBeInTheDocument();
    });
  });

  it('rechaza el envío y muestra error cuando la confirmación no coincide', async () => {
    const user = userEvent.setup();
    render(<ProfilePasswordField />);

    await user.click(screen.getByRole('button', { name: /editar contraseña/i }));
    await user.type(screen.getByPlaceholderText('Contraseña actual'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Nueva contraseña'), 'NewPass456!');
    await user.type(screen.getByPlaceholderText('Confirmar nueva contraseña'), 'Diferente789!');
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('contraseña actual incorrecta (400) muestra error inline, campos siguen visibles', async () => {
    const user = userEvent.setup();
    changePassword.mockRejectedValue({ status: 400, message: 'Contraseña actual incorrecta' });
    render(<ProfilePasswordField />);

    await user.click(screen.getByRole('button', { name: /editar contraseña/i }));
    await user.type(screen.getByPlaceholderText('Contraseña actual'), 'WrongPass!');
    await user.type(screen.getByPlaceholderText('Nueva contraseña'), 'NewPass456!');
    await user.type(screen.getByPlaceholderText('Confirmar nueva contraseña'), 'NewPass456!');
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(screen.getByText(/incorrecta/i)).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/contraseña actual/i)).toBeInTheDocument();
  });

  it('Cancelar vuelve a idle limpiando los campos', async () => {
    const user = userEvent.setup();
    render(<ProfilePasswordField />);

    await user.click(screen.getByRole('button', { name: /editar contraseña/i }));
    await user.type(screen.getByPlaceholderText(/contraseña actual/i), 'algo');
    await user.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.getByText('••••••••')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/contraseña actual/i)).not.toBeInTheDocument();
  });

  it('tecla Escape en modo editing vuelve a idle', async () => {
    const user = userEvent.setup();
    render(<ProfilePasswordField />);

    await user.click(screen.getByRole('button', { name: /editar contraseña/i }));
    expect(screen.getByPlaceholderText(/contraseña actual/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByText('••••••••')).toBeInTheDocument();
    });
  });
});
