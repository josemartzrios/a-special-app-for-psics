import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PatientSidebar from './PatientSidebar'

const defaultProps = {
  conversations: [],
  selectedPatientId: null,
  onSelectConversation: vi.fn(),
  onDeleteConversation: vi.fn(),
  onNewPatient: vi.fn(),
  isCreatingPatient: false,
  newPatientName: '',
  onNewPatientNameChange: vi.fn(),
  onSavePatient: vi.fn(),
  onCancelNewPatient: vi.fn(),
}

describe('PatientSidebar — logout button', () => {
  it('does not render "Cerrar sesión" (moved to App.jsx desktop sidebar bottom strip)', () => {
    render(<PatientSidebar {...defaultProps} />)
    expect(screen.queryByRole('button', { name: /cerrar sesión/i })).not.toBeInTheDocument()
  })
})

describe('PatientSidebar — nuevo paciente button', () => {
  it('does not render visible "Nuevo paciente" text (wide button is gone)', () => {
    render(<PatientSidebar {...defaultProps} />)
    expect(screen.queryByText('Nuevo paciente')).not.toBeInTheDocument()
  })
  it('renders a + icon button next to the PACIENTES label', () => {
    render(<PatientSidebar {...defaultProps} />)
    expect(screen.getByTitle('Nuevo paciente')).toBeInTheDocument()
  })
  it('calls onNewPatient when the + icon button is clicked', async () => {
    const onNewPatient = vi.fn()
    render(<PatientSidebar {...defaultProps} onNewPatient={onNewPatient} />)
    await userEvent.click(screen.getByTitle('Nuevo paciente'))
    expect(onNewPatient).toHaveBeenCalledOnce()
  })
  it('shows inline creation form when isCreatingPatient is true', () => {
    render(<PatientSidebar {...defaultProps} isCreatingPatient={true} />)
    expect(screen.getByPlaceholderText(/nombre del paciente/i)).toBeInTheDocument()
  })
})

describe('PatientSidebar — draft badge', () => {
  const conv = {
    patient_id: '42',
    patient_name: 'Juan García',
    session_number: 3,
    session_date: '2026-04-18',
    dictation_preview: null,
    status: 'confirmed',
  }

  it('shows Borrador badge when patient has draft', () => {
    render(
      <PatientSidebar
        {...defaultProps}
        conversations={[conv]}
        draftPatientIds={new Set(['42'])}
      />
    )
    expect(screen.getByText('Borrador')).toBeInTheDocument()
    expect(screen.queryByText('Confirmada')).not.toBeInTheDocument()
  })

  it('shows Confirmada badge when patient has no draft', () => {
    render(
      <PatientSidebar
        {...defaultProps}
        conversations={[conv]}
        draftPatientIds={new Set()}
      />
    )
    expect(screen.getByText('Confirmada')).toBeInTheDocument()
    expect(screen.queryByText('Borrador')).not.toBeInTheDocument()
  })

  it('shows no badge when patient has no sessions', () => {
    const noSessions = { ...conv, session_number: null }
    render(
      <PatientSidebar
        {...defaultProps}
        conversations={[noSessions]}
        draftPatientIds={new Set()}
      />
    )
    expect(screen.queryByText('Borrador')).not.toBeInTheDocument()
    expect(screen.queryByText('Confirmada')).not.toBeInTheDocument()
    expect(screen.getByText('Sin sesiones')).toBeInTheDocument()
  })
})


describe('PatientSidebar — patient search', () => {
  const CONVS = [
    { patient_id: 'p1', patient_name: 'María García', session_number: 1, status: 'confirmed', dictation_preview: null },
    { patient_id: 'p2', patient_name: 'Carlos Ruiz',  session_number: 2, status: 'confirmed', dictation_preview: null },
    { patient_id: 'p3', patient_name: 'Ana López',    session_number: 1, status: 'confirmed', dictation_preview: null },
  ]

  it('renders search input', () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    expect(screen.getByPlaceholderText(/buscar paciente/i)).toBeInTheDocument()
  })

  it('filters patients by name case-insensitively', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'garcia')
    expect(screen.getByText('María García')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Ruiz')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument()
  })

  it('shows "Sin resultados" when no patients match the query', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'xyz')
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
  })

  it('clear button is hidden when query is empty', () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    expect(screen.queryByRole('button', { name: /limpiar búsqueda/i })).not.toBeInTheDocument()
  })

  it('clear button appears when query is non-empty', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    await userEvent.type(screen.getByPlaceholderText(/buscar paciente/i), 'g')
    expect(screen.getByRole('button', { name: /limpiar búsqueda/i })).toBeInTheDocument()
  })

  it('clear button click resets query and returns focus to input', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'garcia')
    await userEvent.click(screen.getByRole('button', { name: /limpiar búsqueda/i }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('Escape clears the query when non-empty', async () => {
    render(<PatientSidebar {...defaultProps} conversations={CONVS} />)
    const input = screen.getByPlaceholderText(/buscar paciente/i)
    await userEvent.type(input, 'garcia')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })
})
