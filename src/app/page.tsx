import { headers } from 'next/headers';

async function getRecentActivity() {
  try {
    const sheetsService = (await import('@/lib/google/sheets')).GoogleSheetsService;
    const authModule = await import('@/lib/google/auth');
    const service = await authModule.initializeGoogleSheets();
    const logs = await service.getRecentAuditLogs(5); // Get last 5 logs
    return logs;
  } catch (error) {
    console.error('Error fetching logs:', error);
    return [];
  }
}

export default async function Home() {
  const recentLogs = await getRecentActivity();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-5xl w-full">
        <h1 className="text-4xl font-bold mb-8">Catalyst Scheduler</h1>
        
        <div className="mb-8">
          <div className="flex items-center space-x-2 mb-4">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <p className="text-xl">Webhook Status: Active</p>
          </div>
          
          <div className="bg-gray-100 p-6 rounded-lg mb-8">
            <h2 className="text-2xl font-semibold mb-4">Endpoints:</h2>
            <ul className="space-y-2">
              <li>
                <span className="text-blue-600">/api/webhooks/intakeq</span>
                <span className="ml-2 text-gray-600">- IntakeQ Webhooks Handler</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg">
          <h2 className="text-2xl font-semibold p-6 border-b">Recent Activity</h2>
          <div className="divide-y">
            {recentLogs.length > 0 ? (
              recentLogs.map((log, index) => (
                <div key={index} className="p-6">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-medium">{log.eventType}</span>
                    <span className="text-sm text-gray-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-gray-600">{log.description}</p>
                  {log.systemNotes && (
                    <pre className="mt-2 text-sm bg-gray-50 p-2 rounded">
                      {log.systemNotes}
                    </pre>
                  )}
                </div>
              ))
            ) : (
              <div className="p-6 text-gray-500">No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}