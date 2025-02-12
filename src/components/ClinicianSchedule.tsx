"use client";

import React, { useState, useEffect } from 'react';
import type { AppointmentRecord } from '@/types/scheduling';
import type { SheetOffice, SheetClinician } from '@/types/sheets';

interface ClinicianScheduleProps {
  clinician: SheetClinician;
  appointments: AppointmentRecord[];
  offices: SheetOffice[];
  selectedDate: Date;
}

const ClinicianSchedule = ({ clinician, appointments, offices, selectedDate }: ClinicianScheduleProps) => {
  const [conflicts, setConflicts] = useState<{[key: string]: AppointmentRecord[]}>({});
  const [officeCapacity, setOfficeCapacity] = useState<{[key: string]: number}>({});

  // Constants for layout
  const TIME_CELL_HEIGHT = 40; // Height of each 30-minute slot in pixels
  const HEADER_HEIGHT = 50; // Height of the office header row

  // Generate time slots from 7:30 AM to 9:00 PM in 30-minute increments
  const timeSlots = React.useMemo(() => {
    const slots = [];
    const baseDate = new Date(selectedDate);
    baseDate.setHours(7, 30, 0, 0);
    
    const endDate = new Date(selectedDate);
    endDate.setHours(21, 0, 0, 0);
    
    while (baseDate <= endDate) {
      slots.push(new Date(baseDate));
      baseDate.setMinutes(baseDate.getMinutes() + 30);
    }
    
    return slots;
  }, [selectedDate]);

  // Helper for formatting time display
  const formatTimeDisplay = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).replace(/\s/g, ''); // Remove space between time and AM/PM
  };

  // Calculate grid position for a given time
  const getTimePosition = (timeString: string) => {
    const time = new Date(timeString);
    const baseTime = new Date(time);
    baseTime.setHours(7, 30, 0, 0);
    
    const diffMs = time.getTime() - baseTime.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    
    return Math.floor((diffMinutes / 30) * TIME_CELL_HEIGHT);
  };

  // Render the time column
  const TimeColumn = () => (
    <div className="w-20 flex-shrink-0 relative">
      <div className="h-[50px] border-b bg-gray-50 p-2">
        <span className="text-sm font-medium">Time</span>
      </div>
      <div className="relative">
        {timeSlots.map((time, index) => (
          <div
            key={index}
            className="absolute left-0 h-[40px] w-full border-t border-gray-100 px-2"
            style={{ top: `${index * TIME_CELL_HEIGHT}px` }}
          >
            <span className="text-xs text-gray-500">
              {formatTimeDisplay(time)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  // Render appointment blocks
  const AppointmentBlock = ({ appointment }: { appointment: AppointmentRecord }) => {
    const start = new Date(appointment.startTime);
    const end = new Date(appointment.endTime);
    const duration = (end.getTime() - start.getTime()) / (1000 * 60);
    const height = (duration / 30) * TIME_CELL_HEIGHT;
    const top = getTimePosition(appointment.startTime);

    const getAppointmentStyle = () => {
      const baseStyle = 'absolute w-[95%] left-[2.5%] rounded p-2 text-sm';
      switch (appointment.sessionType) {
        case 'in-person':
          return `${baseStyle} bg-blue-100`;
        case 'telehealth':
          return `${baseStyle} bg-green-100`;
        case 'group':
          return `${baseStyle} bg-purple-100`;
        case 'family':
          return `${baseStyle} bg-yellow-100`;
        default:
          return `${baseStyle} bg-gray-100`;
      }
    };

    return (
      <div
        className={getAppointmentStyle()}
        style={{
          top: `${top}px`,
          height: `${height}px`
        }}
      >
        <div className="font-medium text-xs">
          {formatTimeDisplay(start)}
        </div>
        <div className="text-xs mt-1">
          {appointment.sessionType}
        </div>
      </div>
    );
  };

  // Render office columns
  const OfficeColumn = ({ office, date }: { office: SheetOffice, date: Date }) => {
    const dayAppointments = appointments.filter(app => {
      const appDate = new Date(app.startTime);
      return (
        app.officeId === office.officeId &&
        appDate.getDate() === date.getDate() &&
        appDate.getMonth() === date.getMonth()
      );
    });

    return (
      <div className="flex-1 min-w-[200px] border-l">
        <div className="h-[50px] border-b bg-gray-50 p-2">
          <div className="font-medium">{office.name}</div>
          <div className="text-xs text-gray-500">
            {dayAppointments.length}/2 {office.isAccessible && '♿'}
          </div>
        </div>
        <div 
          className="relative"
          style={{ height: `${timeSlots.length * TIME_CELL_HEIGHT}px` }}
        >
          {timeSlots.map((_, index) => (
            <div
              key={index}
              className="absolute w-full border-t border-gray-100"
              style={{ top: `${index * TIME_CELL_HEIGHT}px` }}
            />
          ))}
          {dayAppointments.map(appointment => (
            <AppointmentBlock
              key={appointment.appointmentId}
              appointment={appointment}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full border rounded-lg shadow-sm bg-white">
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">
          Schedule View - {selectedDate.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          })}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-full">
          <TimeColumn />
          <div className="flex flex-1">
            {offices.map(office => (
              <OfficeColumn
                key={office.officeId}
                office={office}
                date={selectedDate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClinicianSchedule;