import { sampleFacilities, type Facility } from "./sample-data";

// Replace this data-access function when the facilities backend is available.
export function getFacilities(): Facility[] {
  return sampleFacilities.map((facility) => ({ ...facility, equipment: [...facility.equipment] }));
}
