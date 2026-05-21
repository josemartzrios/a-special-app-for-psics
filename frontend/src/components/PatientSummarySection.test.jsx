import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PatientSummarySection from './PatientSummarySection'

const SENT_SUMMARY = {
  id: 'sum-1',
  topics_worked: 'Hoy hablamos sobre el estrés laboral.',
  homework: 'Llevar un diario de emociones esta semana.',
  sent_at: '2026-05-21T14:32:00Z',
}

vi.mock('../api', () => ({
  getSummary: vi.fn(() => Promise.resolve(SENT_SUMMARY)),
  generateSummary: vi.fn(),
  saveSummary: vi.fn(),
  sendSummaryToPortal: vi.fn(),
}))

describe('PatientSummarySection — fase sent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el banner de confirmación cuando el resumen ya fue enviado', async () => {
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
  })

  it('no muestra el contenido del resumen por defecto', async () => {
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    expect(screen.queryByText('Hoy hablamos sobre el estrés laboral.')).not.toBeInTheDocument()
    expect(screen.queryByText('Llevar un diario de emociones esta semana.')).not.toBeInTheDocument()
  })

  it('muestra el contenido tras hacer click en "Ver resumen"', async () => {
    const user = userEvent.setup()
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    await user.click(screen.getByRole('button', { name: /Ver resumen/i }))
    expect(screen.getByText('Hoy hablamos sobre el estrés laboral.')).toBeInTheDocument()
    expect(screen.getByText('Llevar un diario de emociones esta semana.')).toBeInTheDocument()
  })

  it('colapsa el contenido al hacer click en "Ocultar"', async () => {
    const user = userEvent.setup()
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    await user.click(screen.getByRole('button', { name: /Ver resumen/i }))
    await screen.findByText('Hoy hablamos sobre el estrés laboral.')
    await user.click(screen.getByRole('button', { name: /Ocultar/i }))
    await waitFor(() => {
      expect(screen.queryByText('Hoy hablamos sobre el estrés laboral.')).not.toBeInTheDocument()
    })
  })

  it('los campos expandidos no tienen cursor:text', async () => {
    const user = userEvent.setup()
    render(<PatientSummarySection sessionId="s1" patientName="Ana López" />)
    await screen.findByText(/Seguimiento enviado a Ana/i)
    await user.click(screen.getByRole('button', { name: /Ver resumen/i }))
    const field = await screen.findByText('Hoy hablamos sobre el estrés laboral.')
    expect(field).not.toHaveStyle('cursor: text')
  })
})
