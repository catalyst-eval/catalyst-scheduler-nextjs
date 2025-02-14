// src/app/dashboard/page.tsx

import { initializeGoogleSheets } from '@/lib/google/auth';
import { IntakeQService } from '@/lib/intakeq/service';
import ScheduleDashboard from '@/components/ScheduleDashboard';
import type { ScheduleDashboardProps } from '@/components/ScheduleDashboard';
import { transformIntakeQAppointment } from '@/lib/transformations/appointment-types';

async function getScheduleData(): Promise<ScheduleDashboardProps['initialData']> {
  try {
    const sheetsService = await initializeGoogleSheets();
    const intakeQService = new IntakeQService(
      process.env.INTAKEQ_API_KEY!,
      sheetsService
    );

    // Get today's date in ISO format
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    // Fetch all data concurrently
    const [rawAppointments, offices, clinicians] = await Promise.all([
      intakeQService.getAppointments(
        `${today}T00:00:00Z`,
        `${tomorrowISO}T00:00:00Z`
      ),
      sheetsService.getOffices(),
      sheetsService.getClinicians()
    ]);

    // Transform appointments using the centralized transformer
    const appointments = rawAppointments.map(appt => transformIntakeQAppointment(appt));

    return {
      appointments,
      offices,
      clinicians
    };
  } catch (error) {
    console.error('Error fetching schedule data:', error);
    return {
      appointments: [],
      offices: [],
      clinicians: []
    };
  }
}

export default async function DashboardPage() {
  const initialData = await getScheduleData();

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-semibold mb-6">Schedule Dashboard</h1>
        <ScheduleDashboard initialData={initialData} />
      </div>
    </main>
  );
}