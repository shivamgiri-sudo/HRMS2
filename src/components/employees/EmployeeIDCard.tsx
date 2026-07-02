import { useState, useEffect } from "react";
import { buildEmployeeIdQrData, buildQrCodeUrl } from "@/integrations/apis/qrCode.api";
import { Card } from "@/components/ui/card";
import { normalizeMediaUrl } from "@/lib/mediaUrl";

interface EmployeeIDCardProps {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  photoUrl?: string;
  emergencyContact: string;
  bloodGroup: string;
}

export function EmployeeIDCard({
  employeeId,
  employeeCode,
  fullName,
  designation,
  photoUrl,
  emergencyContact,
  bloodGroup,
}: EmployeeIDCardProps) {
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    const qrData = buildEmployeeIdQrData(employeeCode, employeeId);
    buildQrCodeUrl(qrData, 100).then(setQrUrl).catch(() => setQrUrl(""));
  }, [employeeCode, employeeId]);

  return (
    <Card className="w-[340px] bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg">
      {/* Header with logo */}
      <div className="bg-white px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-center">
          <img src="/mcn-logo.png" alt="MAS Callnet" className="h-10" />
        </div>
        <p className="text-center text-xs font-semibold text-gray-700 mt-1">
          Mas Callnet India Pvt. Ltd.
        </p>
      </div>

      {/* Photo section */}
      <div className="px-6 py-4 flex justify-center">
        <div className="w-28 h-28 rounded-lg overflow-hidden border-4 border-red-500 shadow-md">
          {photoUrl ? (
            <img src={normalizeMediaUrl(photoUrl)} alt={fullName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">
              No Photo
            </div>
          )}
        </div>
      </div>

      {/* Employee details */}
      <div className="px-6 pb-4 text-center space-y-1">
        <h3 className="text-lg font-bold text-gray-900">{fullName}</h3>
        <p className="text-sm text-gray-600">{designation}</p>
        <p className="text-sm font-semibold text-gray-800">Emp. ID - {employeeCode}</p>
        <p className="text-xs text-gray-600">Emergency Contact No. - {emergencyContact}</p>
        <p className="text-xs italic text-gray-600">BLOOD GROUP - {bloodGroup}</p>
      </div>

      {/* QR Code at bottom */}
      <div className="px-6 pb-4 flex justify-center">
        <div className="text-center">
          <img src={qrUrl} alt="Employee QR" className="w-20 h-20 mx-auto" />
          <p className="text-[10px] text-gray-400 mt-1">Scan for verification</p>
        </div>
      </div>

      {/* Lanyard hole indicator (optional visual) */}
      <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-gray-300 border border-gray-400" />
    </Card>
  );
}
