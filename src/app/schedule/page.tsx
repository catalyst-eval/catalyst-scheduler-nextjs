import React from 'react';
import { initializeGoogleSheets } from '@/lib/google/auth';
import ScheduleView from '@/components/ScheduleView';

async function getScheduleData() {
  try {
    const sheetsService = await initializeGoogleSheets();
    
    // Get today's date in ISO format
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    // Fetch appointments for today
    const appointments = await sheetsService.getAppointments(
      `${today}T00:00:00Z`,
      `${tomorrowISO}T00:00:00Z`
    );

    // Fetch office configurations
    const offices = await sheetsService.getOffices();

    return {
      appointments,
      offices
    };
  } catch (error) {
    console.error('Error fetching schedule data:', error);
    return {
      appointments: [],
      offices: []
    };
  }
}

export default async function SchedulePage() {
  const { appointments, offices } = await getScheduleData();

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Catalyst Scheduler</h1>
      <ScheduleView
        appointments={appointments}
        offices={offices}
        selectedDate={new Date()}
        view="daily"
      />
    </div>
  );
}