// src/components/ScheduleDashboard.tsx
"use client";

import React, { useState } from 'react';
import ScheduleView from '@/components/ScheduleView';
import ClinicianSchedule from '@/components/ClinicianSchedule';
import type { SheetClinician, SheetOffice } from '@/types/sheets';
import type { AppointmentRecord } from '@/types/scheduling';

export interface ScheduleDashboardProps {
  initialData: {
    appointments: AppointmentRecord[];
    offices: SheetOffice[];
    clinicians: SheetClinician[];
  };
}

export default function ScheduleDashboard({ initialData }: ScheduleDashboardProps) {
  const [selectedClinician, setSelectedClinician] = useState<SheetClinician | null>(null);
  const [selectedDate] = useState(new Date());
  const { appointments, offices, clinicians } = initialData;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Catalyst Scheduler</h1>
      
      {/* Team Schedule View */}
      <div className="mb-8">
        <ScheduleView
          appointments={appointments}
          offices={offices}
          selectedDate={selectedDate}
          view="daily"
        />
      </div>

      {/* Clinician Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          View Clinician Schedule
        </label>
        <select
          className="block w-full max-w-md border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          value={selectedClinician?.clinicianId || ''}
          onChange={(e) => {
            const clinician = clinicians.find(c => c.clinicianId === e.target.value);
            setSelectedClinician(clinician || null);
          }}
        >
          <option value="">Select a clinician...</option>
          {clinicians.map((clinician: SheetClinician) => (
            <option key={clinician.clinicianId} value={clinician.clinicianId}>
              {clinician.name}
            </option>
          ))}
        </select>
      </div>

      {/* Individual Clinician View */}
      {selectedClinician && (
        <div className="mt-8">
          <ClinicianSchedule
            clinician={selectedClinician}
            appointments={appointments.filter(
              app => app.clinicianId === selectedClinician.clinicianId
            )}
            offices={offices}
            selectedDate={selectedDate}
          />
        </div>
      )}
    </div>
  );
}