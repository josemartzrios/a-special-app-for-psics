import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from './Sidebar'

const ONE_CONV = [{
  id: 'sess-1', patient_id: 'p1', patient_name: 'María López',
  session_date: '2026-01-15', session_number: 1,
  status: 'confirmed', dictation_preview: 'Texto de prueba'
}]

const THREE_CONVS = [
  { id: 'sess-1', patient_id: 'p1', patient_name: 'María López',   session_date: '2026-01-15', session_number: 1, status: 'confirmed', dictation_preview: 'A' },
  { id: 'sess-2', patient_id: 'p2', patient_name: 'Carlos Ruiz',   session_date: '2026-01-22', session_number: 2, status: 'draft',     dictation_preview: 'B' },
  { id: 'sess-3', patient_id: 'p3', patient_name: 'Ana Gómez',     session_date: '2026-01-29', session_number: 3, status: 'confirmed', dictation_preview: 'C' },
]

const noop = () => {}

describe('Sidebar', () => {
  it('open=false: panel tiene clase -translate-x-full', () => {
    render(<Sidebar open={false} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} />)
    const panel = screen.getByTestId('sidebar-panel')
    expect(panel.classList.contains('-translate-x-full')).toBe(true)
  })

  it('open=true: panel tiene clase translate-x-0', () => {
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} />)
    const panel = screen.getByTestId('sidebar-panel')
    expect(panel.classList.contains('translate-x-0')).toBe(true)
  })

  it('click en backdrop llama onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Sidebar open={true} onClose={onClose} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} />)
    await user.click(screen.getByTestId('sidebar-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('click en botón X llama onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Sidebar open={true} onClose={onClose} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} />)
    await user.click(screen.getByRole('button', { name: /^cerrar$/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('estado vacío: muestra "Sin sesiones registradas"', () => {
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} />)
    expect(screen.getByText(/Sin sesiones registradas/i)).toBeInTheDocument()
  })

  it('click en conversación llama onSelectConversation antes que onClose', async () => {
    const user = userEvent.setup()
    const onSelectConversation = vi.fn()
    const onClose = vi.fn()
    render(<Sidebar open={true} onClose={onClose} conversations={THREE_CONVS} onSelectConversation={onSelectConversation} onDeleteConversation={noop} />)
    await user.click(screen.getByText('María López'))
    expect(onSelectConversation).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelectConversation.mock.invocationCallOrder[0])
      .toBeLessThan(onClose.mock.invocationCallOrder[0])
  })

  it('primer click en eliminar muestra estado de confirmación, NO llama onDeleteConversation', async () => {
    const user = userEvent.setup()
    const onDeleteConversation = vi.fn()
    render(<Sidebar open={true} onClose={noop} conversations={ONE_CONV} onSelectConversation={noop} onDeleteConversation={onDeleteConversation} />)
    await user.click(screen.getByTitle('Archivar sesión'))
    expect(screen.getByTitle('Confirmar')).toBeInTheDocument()
    expect(onDeleteConversation).not.toHaveBeenCalled()
  })

  it('segundo click en eliminar llama onDeleteConversation', async () => {
    const user = userEvent.setup()
    const onDeleteConversation = vi.fn()
    render(<Sidebar open={true} onClose={noop} conversations={ONE_CONV} onSelectConversation={noop} onDeleteConversation={onDeleteConversation} />)
    await user.click(screen.getByTitle('Archivar sesión'))
    await user.click(screen.getByTitle('Confirmar'))
    expect(onDeleteConversation).toHaveBeenCalledOnce()
  })

  it('renderiza el botón "Cerrar sesión"', () => {
    const onLogout = vi.fn()
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} onLogout={onLogout} />)
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument()
  })

  it('click en "Cerrar sesión" llama onLogout', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} onLogout={onLogout} />)
    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }))
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('no explota si onLogout no se pasa — botón sigue renderizando', () => {
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} />)
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument()
  })

  it('no muestra "Cancelar suscripción" cuando canCancelSubscription=false', () => {
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} canCancelSubscription={false} />)
    expect(screen.queryByRole('button', { name: /cancelar suscripción/i })).not.toBeInTheDocument()
  })

  it('muestra "Cancelar suscripción" cuando canCancelSubscription=true', () => {
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} canCancelSubscription={true} onCancelSubscription={noop} />)
    expect(screen.getByRole('button', { name: /cancelar suscripción/i })).toBeInTheDocument()
  })

  it('click en "Cancelar suscripción" llama onCancelSubscription', async () => {
    const user = userEvent.setup()
    const onCancelSubscription = vi.fn()
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} canCancelSubscription={true} onCancelSubscription={onCancelSubscription} />)
    await user.click(screen.getByRole('button', { name: /cancelar suscripción/i }))
    expect(onCancelSubscription).toHaveBeenCalledOnce()
  })

  it('"Cancelar suscripción" aparece antes de "Cerrar sesión" en el DOM', () => {
    render(<Sidebar open={true} onClose={noop} conversations={[]} onSelectConversation={noop} onDeleteConversation={noop} canCancelSubscription={true} onCancelSubscription={noop} onLogout={noop} />)
    const buttons = screen.getAllByRole('button')
    const cancelIdx = buttons.findIndex(b => /cancelar suscripción/i.test(b.textContent))
    const logoutIdx = buttons.findIndex(b => /cerrar sesión/i.test(b.textContent))
    expect(cancelIdx).toBeLessThan(logoutIdx)
  })
})

describe('Sidebar — patient search', () => {
  const SEARCH_CONVS = [
    { id: 'sess-1', patient_id: 'p1', patient_name: 'María López',  session_date: '2026-01-15', session_number: 1, status: 'confirmed', dictation_preview: 'A' },
    { id: 'sess-2', patient_id: 'p2', patient_name: 'Carlos Ruiz',  session_date: '2026-01-22', session_number: 2, status: 'draft',     dictation_preview: 'B' },
    { id: 'sess-3', patient_id: 'p3', patient_name: 'Ana Gómez',    session_date: '2026-01-29', session_number: 3, status: 'confirmed', dictation_preview: 'C' },
  ]

  it('renders search input', () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    expect(screen.getByPlaceholderText(/buscar paciente/i)).toBeInTheDocument()
  })

  it('filters patients by name case-insensitively', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'lopez')
    expect(screen.getByText('María López')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Ruiz')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana Gómez')).not.toBeInTheDocument()
  })

  it('shows "Sin resultados" when no patients match the query', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'xyz')
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
  })

  it('clear button is hidden when query is empty', () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    expect(screen.queryByRole('button', { name: /limpiar búsqueda/i })).not.toBeInTheDocument()
  })

  it('clear button appears when query is non-empty', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'l')
    expect(screen.getByRole('button', { name: /limpiar búsqueda/i })).toBeInTheDocument()
  })

  it('clear button click resets query and returns focus to input', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'lopez')
    await userEvent.click(screen.getByRole('button', { name: /limpiar búsqueda/i }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('Escape clears the query when non-empty', async () => {
    render(<Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'lopez')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('query resets to empty when slide-over closes (open goes false)', async () => {
    const { rerender } = render(
      <Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />
    )
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'lopez')
    rerender(
      <Sidebar open={false} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />
    )
    rerender(
      <Sidebar open={true} onClose={noop} conversations={SEARCH_CONVS} onSelectConversation={noop} onDeleteConversation={noop} />
    )
    expect(screen.getByPlaceholderText(/buscar paciente/i)).toHaveValue('')
  })
})
