// src/app/dashboard/page.tsx
import { initializeGoogleSheets } from '@/lib/google/auth';
import ScheduleDashboard from '@/components/ScheduleDashboard';
import type { ScheduleDashboardProps } from '@/components/ScheduleDashboard';

async function getScheduleData(): Promise<ScheduleDashboardProps['initialData']> {
  try {
    const sheetsService = await initializeGoogleSheets();
    
    // Get today's date in ISO format
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    // Fetch all data concurrently
    const [appointments, offices, clinicians] = await Promise.all([
      sheetsService.getAppointments(
        `${today}T00:00:00Z`,
        `${tomorrowISO}T00:00:00Z`
      ),
      sheetsService.getOffices(),
      sheetsService.getClinicians()
    ]);

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
    <ScheduleDashboard initialData={initialData} />
  );
}