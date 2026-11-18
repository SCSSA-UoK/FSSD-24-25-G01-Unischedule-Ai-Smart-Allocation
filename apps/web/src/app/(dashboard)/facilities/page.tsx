"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { getFacilities } from "@/lib/facilities/facilities-service";
import type { Facility } from "@/lib/facilities/sample-data";
import "./facilities.css";

const types: Facility["type"][] = ["Lecture Room", "Computer Lab", "Laboratory"];
const statuses: Facility["status"][] = ["Available", "In Use", "Maintenance"];
const roomFields = [
  { name: "code", label: "Room code", placeholder: "SCI-405" },
  { name: "name", label: "Room name", placeholder: "Applied Computing Lab" },
  { name: "building", label: "Building", list: "room-buildings" },
  { name: "floor", label: "Floor", placeholder: "Ground or 2" },
  { name: "type", label: "Facility type" },
  { name: "capacity", label: "Seating capacity" },
  { name: "equipment", label: "Equipment (optional)", placeholder: "Projector, 30 computers" },
] as const;
type RoomErrors = Partial<Record<(typeof roomFields)[number]["name"], string>>;

export default function FacilitiesPage() {
  const [facilities, setFacilities] = useState(getFacilities);
  const [search, setSearch] = useState("");
  const [building, setBuilding] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<Facility | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const registerDialogRef = useRef<HTMLDialogElement>(null);
  const registerButtonRef = useRef<HTMLButtonElement>(null);
  const registerFormRef = useRef<HTMLFormElement>(null);
  const [roomErrors, setRoomErrors] = useState<RoomErrors>({});
  const [registeredCode, setRegisteredCode] = useState("");

  const buildings = useMemo(() => [...new Set(facilities.map((item) => item.building))].sort(), [facilities]);
  const summary = useMemo(() => ({
    total: facilities.length,
    available: facilities.filter((item) => item.status === "Available").length,
    maintenance: facilities.filter((item) => item.status === "Maintenance").length,
    capacity: facilities.reduce((total, item) => total + item.capacity, 0),
  }), [facilities]);
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return facilities.filter((item) =>
      (!building || item.building === building) &&
      (type === "ALL" || item.type === type) &&
      (status === "ALL" || item.status === status) &&
      [item.code, item.name, item.building].some((value) => value.toLocaleLowerCase().includes(term))
    );
  }, [facilities, search, building, type, status]);

  function openDetails(item: Facility) {
    setSelected(item);
    dialogRef.current?.showModal();
  }

  function clearFilters() {
    setSearch("");
    setBuilding("");
    setType("ALL");
    setStatus("ALL");
  }

  function registerRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const code = value("code");
    const name = value("name");
    const roomBuilding = value("building");
    const floor = value("floor");
    const roomType = types.find((option) => option === value("type"));
    const capacity = Number(value("capacity"));
    const errors: RoomErrors = {};

    if (!code) errors.code = "Enter a room code.";
    else if (facilities.some((room) => room.code.toLowerCase() === code.toLowerCase())) {
      errors.code = "This room code is already registered.";
    }
    if (!name) errors.name = "Enter a room name.";
    if (!roomBuilding) errors.building = "Enter a building.";
    if (!floor) errors.floor = "Enter a floor.";
    if (!roomType) errors.type = "Select a facility type.";
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      errors.capacity = "Enter a positive whole number.";
    }

    setRoomErrors(errors);
    const firstInvalidField = roomFields.find((field) => errors[field.name]);
    if (firstInvalidField || !roomType) {
      if (firstInvalidField) {
        const input = form.elements.namedItem(firstInvalidField.name);
        if (input instanceof HTMLElement) input.focus();
      }
      return;
    }

    const room: Facility = {
      id: `registered-${facilities.length + 1}`,
      code,
      name,
      building: roomBuilding,
      floor,
      type: roomType,
      capacity,
      status: "Available",
      equipment: [...new Set(value("equipment").split(",").map((item) => item.trim()).filter(Boolean))],
    };
    setFacilities((current) => [room, ...current]);
    clearFilters();
    setRegisteredCode(code);
    registerDialogRef.current?.close();
  }

  function resetRegistration() {
    registerFormRef.current?.reset();
    setRoomErrors({});
    registerButtonRef.current?.focus();
  }

  return (
    <main className="site-shell facilities-page">
      <header className="header">
        <div className="brand-symbol">U</div>
        <div className="brand-copy"><strong>UniSchedule <span>AI</span></strong><small>University timetable workspace</small></div>
        <span className="header-pill">Facilities · Demo</span>
      </header>

      <nav className="tabs" aria-label="Workspace views">
        <Link href="/">Timetable explorer</Link>
        <Link href="/facilities" className="active" aria-current="page">Facilities</Link>
      </nav>

      <section className="facilities-intro">
        <p className="eyebrow">CAMPUS RESOURCES</p>
        <h1>Find the right <em>space.</em></h1>
        <p className="hero-subtitle">Explore rooms and labs across campus buildings.</p>
      </section>

      <div className="notice" role="note"><span aria-hidden="true">ⓘ</span><p><strong>Demo data — backend not connected.</strong> Facility status and capacity are fictional examples, not live availability.</p></div>

      <section aria-labelledby="overview-heading" className="facilities-overview">
        <div className="facilities-section-heading"><div><p className="eyebrow">AT A GLANCE</p><h2 id="overview-heading">All sample facilities</h2></div><p>These totals cover every sample facility, regardless of the filters below.</p></div>
        <div className="facilities-stats">
          <article className="panel"><strong>{summary.total}</strong><span>Total facilities</span></article>
          <article className="panel"><strong>{summary.available}</strong><span>Available facilities</span></article>
          <article className="panel"><strong>{summary.maintenance}</strong><span>Under maintenance</span></article>
          <article className="panel"><strong>{summary.capacity}</strong><span>Total seating capacity</span></article>
        </div>
      </section>

      <section aria-labelledby="directory-heading" className="facilities-directory panel">
        <div className="facilities-section-heading facilities-directory-heading">
          <div><p className="eyebrow">DIRECTORY</p><h2 id="directory-heading">Facilities</h2></div>
          <button ref={registerButtonRef} className="primary-button" type="button" onClick={() => registerDialogRef.current?.showModal()}>+ Register Room</button>
        </div>
        <div role="status">{registeredCode && <p className="facilities-registration-success">Room <strong>{registeredCode}</strong> registered.</p>}</div>
        <div className="facilities-filters">
          <label>Search rooms<input className="field" type="search" placeholder="Code, name, or building" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Building<select className="select" value={building} onChange={(event) => setBuilding(event.target.value)}><option value="">All buildings</option>{buildings.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Facility type<select className="select" value={type} onChange={(event) => setType(event.target.value)}><option value="ALL">All types</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Status<select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
          <button className="facilities-clear" type="button" onClick={clearFilters}>Clear filters</button>
        </div>

        <p className="facilities-count" role="status">{matches.length} matching {matches.length === 1 ? "facility" : "facilities"} <span>of {summary.total} sample facilities</span></p>
        {matches.length ? <div className="facilities-list" role="list">
          {matches.map((item) => <article className="facilities-row" role="listitem" key={item.id}>
            <div className="facilities-identity"><strong>{item.code}</strong><span>{item.name}</span></div>
            <div className="facilities-meta"><span className="facilities-mobile-label">Building</span>{item.building}</div>
            <div className="facilities-meta"><span className="facilities-mobile-label">Type</span>{item.type}</div>
            <div className="facilities-meta"><span className="facilities-mobile-label">Capacity</span>{item.capacity} seats</div>
            <div><span className={`facilities-badge facilities-badge-${item.status.toLowerCase().replace(" ", "-")}`}>{item.status}</span></div>
            <button className="facilities-details-button" type="button" onClick={() => openDetails(item)} aria-label={`View details for ${item.code}`}>View Details</button>
          </article>)}
        </div> : <div className="empty-state"><strong>No facilities match your search.</strong><p>Try a different room, building, type, or status, or clear the filters.</p><button className="facilities-clear" type="button" onClick={clearFilters}>Clear filters</button></div>}
      </section>

      <dialog ref={registerDialogRef} className="facilities-dialog" aria-labelledby="register-room-title" aria-describedby="register-room-note" onClose={resetRegistration}>
        <div className="facilities-dialog-heading">
          <div>
            <h2 id="register-room-title">Register Room</h2>
            <p id="register-room-note">Demo rooms reset when you refresh the page.</p>
          </div>
        </div>
        <form ref={registerFormRef} onSubmit={registerRoom} noValidate>
          <div className="facilities-room-fields">
            {roomFields.map((field) => {
              const id = `register-room-${field.name}`;
              const error = roomErrors[field.name];
              const attributes = {
                id,
                name: field.name,
                required: field.name !== "equipment",
                "aria-invalid": error ? true : undefined,
                "aria-describedby": error ? `${id}-error` : undefined,
              };
              return (
                <div className={field.name === "equipment" ? "facilities-equipment" : undefined} key={field.name}>
                  <label htmlFor={id}>{field.label}</label>
                  {field.name === "type" ? (
                    <select className="select" defaultValue="" {...attributes}>
                      <option value="" disabled>Select a facility type</option>
                      {types.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      className="field"
                      type={field.name === "capacity" ? "number" : "text"}
                      min={field.name === "capacity" ? 1 : undefined}
                      step={field.name === "capacity" ? 1 : undefined}
                      placeholder={"placeholder" in field ? field.placeholder : undefined}
                      list={"list" in field ? field.list : undefined}
                      autoFocus={field.name === "code"}
                      {...attributes}
                    />
                  )}
                  {error && <p className="facilities-room-error" id={`${id}-error`} role="alert">{error}</p>}
                </div>
              );
            })}
            <datalist id="room-buildings">{buildings.map((option) => <option key={option} value={option} />)}</datalist>
          </div>
          <div className="facilities-dialog-actions">
            <button className="facilities-clear" type="button" onClick={() => registerDialogRef.current?.close()}>Cancel</button>
            <button className="primary-button" type="submit">Register Room</button>
          </div>
        </form>
      </dialog>

      <dialog ref={dialogRef} className="facilities-dialog" aria-labelledby="facility-dialog-title" onClose={() => setSelected(null)}>
        {selected && <><div className="facilities-dialog-heading"><div><p className="eyebrow">FACILITY DETAILS</p><h2 id="facility-dialog-title">{selected.name}</h2><p>{selected.code}</p></div><button type="button" className="facilities-dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close facility details">×</button></div>
          <dl className="facilities-detail-grid"><div><dt>ID</dt><dd>{selected.id}</dd></div><div><dt>Room code</dt><dd>{selected.code}</dd></div><div><dt>Room name</dt><dd>{selected.name}</dd></div><div><dt>Building</dt><dd>{selected.building}</dd></div><div><dt>Floor</dt><dd>{selected.floor}</dd></div><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Capacity</dt><dd>{selected.capacity} seats</dd></div><div><dt>Status</dt><dd><span className={`facilities-badge facilities-badge-${selected.status.toLowerCase().replace(" ", "-")}`}>{selected.status}</span></dd></div><div className="facilities-equipment"><dt>Equipment</dt><dd><ul>{selected.equipment.map((equipment) => <li key={equipment}>{equipment}</li>)}</ul></dd></div></dl>
        </>}
      </dialog>
      <footer>UniSchedule AI · Fictional facilities demo</footer>
    </main>
  );
}
