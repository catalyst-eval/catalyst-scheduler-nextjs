'use client';

import React, { useState, useEffect } from 'react';
import type { AppointmentRecord } from '@/types/scheduling';
import type { SheetOffice } from '@/types/sheets'

interface ScheduleViewProps {
  appointments: AppointmentRecord[];
  offices: SheetOffice[];
  selectedDate: Date;
  view: 'daily' | 'weekly';
}

const ScheduleView = ({ appointments, offices, selectedDate, view }: ScheduleViewProps) => {
  const [conflicts, setConflicts] = useState<{[key: string]: AppointmentRecord[]}>({});
  const [officeCapacity, setOfficeCapacity] = useState<{[key: string]: number}>({});

  // Helper functions for date manipulation
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false 
    });
  };

  const getStartOfWeek = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
  };

  const addDays = (date: Date, days: number): Date => {
    const newDate = new Date(date);
    newDate.setDate(date.getDate() + days);
    return newDate;
  };

  // Calculate time slots for the day (8am to 6pm)
  const timeSlots = Array.from({ length: 21 }, (_, i) => {
    const hour = Math.floor(i/2) + 8;
    const minute = i % 2 === 0 ? '00' : '30';
    return `${hour.toString().padStart(2, '0')}:${minute}`;
  });

  // Calculate dates to display based on view type
  const getDatesToShow = () => {
    if (view === 'daily') {
      return [selectedDate];
    } else {
      const weekStart = getStartOfWeek(selectedDate);
      return Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
    }
  };

  // Check for scheduling conflicts
  useEffect(() => {
    const newConflicts: {[key: string]: AppointmentRecord[]} = {};
    const newCapacity: {[key: string]: number} = {};

    // Initialize capacity counters
    offices.forEach(office => {
      newCapacity[office.officeId] = 0;
    });

    // Check each appointment against others
    appointments.forEach(app1 => {
      const start1 = new Date(app1.startTime);
      const end1 = new Date(app1.endTime);
      
      // Count towards office capacity
      newCapacity[app1.officeId] = (newCapacity[app1.officeId] || 0) + 1;

      appointments.forEach(app2 => {
        if (app1.appointmentId !== app2.appointmentId && app1.officeId === app2.officeId) {
          const start2 = new Date(app2.startTime);
          const end2 = new Date(app2.endTime);

          if (start1 < end2 && end1 > start2) {
            if (!newConflicts[app1.officeId]) {
              newConflicts[app1.officeId] = [];
            }
            if (!newConflicts[app1.officeId].find(a => a.appointmentId === app1.appointmentId)) {
              newConflicts[app1.officeId].push(app1);
            }
          }
        }
      });
    });

    setConflicts(newConflicts);
    setOfficeCapacity(newCapacity);
  }, [appointments, offices]);

  // Render appointment block
  const AppointmentBlock = ({ appointment }: { appointment: AppointmentRecord }) => {
    const hasConflict = conflicts[appointment.officeId]?.some(
      a => a.appointmentId === appointment.appointmentId
    );

    const getAppointmentStyle = () => {
      const baseStyle = 'rounded p-2 text-sm mb-1 ';
      if (hasConflict) {
        return baseStyle + 'bg-red-100 border-red-500 border';
      }
      switch (appointment.sessionType) {
        case 'in-person':
          return baseStyle + 'bg-blue-100';
        case 'telehealth':
          return baseStyle + 'bg-green-100';
        case 'group':
          return baseStyle + 'bg-purple-100';
        case 'family':
          return baseStyle + 'bg-yellow-100';
        default:
          return baseStyle + 'bg-gray-100';
      }
    };

    return (
      <div className={getAppointmentStyle()}>
        <div className="flex items-center justify-between">
          <span className="font-medium">
            {formatTime(new Date(appointment.startTime))}
          </span>
          {hasConflict && (
            <span className="text-red-500">⚠️</span>
          )}
        </div>
        <div className="mt-1">
          {appointment.requirements?.accessibility && (
            <span className="inline-block bg-blue-200 text-xs px-1 rounded mr-1">♿</span>
          )}
          <span className="text-xs">{appointment.sessionType}</span>
        </div>
      </div>
    );
  };

  // Render office column
  const OfficeColumn = ({ office, date }: { office: SheetOffice, date: Date }) => {
    const dateAppointments = appointments.filter(app => {
      const appDate = new Date(app.startTime);
      return (
        app.officeId === office.officeId &&
        appDate.getDate() === date.getDate() &&
        appDate.getMonth() === date.getMonth() &&
        appDate.getFullYear() === date.getFullYear()
      );
    });

    const isOverCapacity = (officeCapacity[office.officeId] || 0) > 2; // Default max capacity

    return (
      <div className="flex-1 min-w-[200px]">
        <div className="border-b p-2 bg-gray-50">
          <div className="font-medium">{office.name}</div>
          <div className="text-xs flex items-center gap-2">
            <span className={`${isOverCapacity ? 'text-red-500' : 'text-gray-600'}`}>
              {officeCapacity[office.officeId] || 0}/2
            </span>
            {office.isAccessible && <span>♿</span>}
          </div>
        </div>
        <div className="relative min-h-[600px]">
          {dateAppointments.map(appointment => (
            <AppointmentBlock 
              key={appointment.appointmentId} 
              appointment={appointment} 
            />
          ))}
        </div>
      </div>
    );
  };

  // Format date for display
  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <div className="w-full border rounded-lg shadow-sm">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">
            Schedule View - {view === 'daily' ? formatDate(selectedDate) : 
              `Week of ${formatDate(getStartOfWeek(selectedDate))}`}
          </span>
        </div>
      </div>
      <div className="p-4">
        {/* Conflicts Alert */}
        {Object.keys(conflicts).length > 0 && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <span className="text-red-700">
              Scheduling conflicts detected in {Object.keys(conflicts).length} office(s)
            </span>
          </div>
        )}

        {/* Schedule Grid */}
        <div className="overflow-x-auto">
          <div className="flex min-w-full">
            {/* Time Column */}
            <div className="w-20 flex-shrink-0">
              <div className="border-b p-2 bg-gray-50">
                <span className="text-sm">Time</span>
              </div>
              {timeSlots.map(time => (
                <div key={time} className="p-2 border-r text-xs">
                  {time}
                </div>
              ))}
            </div>

            {/* Office Columns */}
            {getDatesToShow().map(date => (
              <div key={date.toISOString()} className="flex flex-1">
                {offices.map(office => (
                  <OfficeColumn 
                    key={`${office.officeId}-${date.toISOString()}`}
                    office={office}
                    date={date}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleView;