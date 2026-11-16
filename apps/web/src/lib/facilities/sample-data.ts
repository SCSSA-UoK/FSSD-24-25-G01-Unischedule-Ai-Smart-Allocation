export type Facility = {
  id: string;
  code: string;
  name: string;
  building: string;
  floor: string;
  type: "Lecture Room" | "Computer Lab" | "Laboratory";
  capacity: number;
  status: "Available" | "In Use" | "Maintenance";
  equipment: string[];
};

// Fictional demonstration records. These are not live availability or bookings.
export const sampleFacilities: Facility[] = [
  { id: "fac-001", code: "SCI-101", name: "Discovery Lecture Room", building: "Science Block", floor: "1", type: "Lecture Room", capacity: 80, status: "Available", equipment: ["Projector", "Audio system", "Whiteboard"] },
  { id: "fac-002", code: "SCI-204", name: "Applied Physics Lab", building: "Science Block", floor: "2", type: "Laboratory", capacity: 32, status: "In Use", equipment: ["Lab benches", "Oscilloscopes", "Safety cabinets"] },
  { id: "fac-003", code: "SCI-310", name: "Chemistry Teaching Lab", building: "Science Block", floor: "3", type: "Laboratory", capacity: 28, status: "Maintenance", equipment: ["Fume hoods", "Lab benches", "Eye wash station"] },
  { id: "fac-004", code: "TEC-105", name: "Digital Skills Lab", building: "Technology Centre", floor: "1", type: "Computer Lab", capacity: 48, status: "Available", equipment: ["48 computers", "Projector", "Network access"] },
  { id: "fac-005", code: "TEC-207", name: "Software Studio", building: "Technology Centre", floor: "2", type: "Computer Lab", capacity: 40, status: "In Use", equipment: ["40 computers", "Dual displays", "Projector"] },
  { id: "fac-006", code: "TEC-302", name: "Networks Laboratory", building: "Technology Centre", floor: "3", type: "Laboratory", capacity: 24, status: "Available", equipment: ["Networking racks", "Workstations", "Projector"] },
  { id: "fac-007", code: "ART-102", name: "Seminar Hall", building: "Arts Building", floor: "1", type: "Lecture Room", capacity: 65, status: "Available", equipment: ["Projector", "Microphones", "Whiteboard"] },
  { id: "fac-008", code: "ART-215", name: "Language Learning Lab", building: "Arts Building", floor: "2", type: "Computer Lab", capacity: 36, status: "Maintenance", equipment: ["36 computers", "Headsets", "Audio console"] },
  { id: "fac-009", code: "MGT-301", name: "Collaborative Lecture Room", building: "Management Wing", floor: "3", type: "Lecture Room", capacity: 55, status: "Available", equipment: ["Interactive display", "Whiteboard", "Audio system"] },
];
