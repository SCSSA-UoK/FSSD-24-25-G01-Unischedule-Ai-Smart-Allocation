"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { getFacilities } from "@/lib/facilities/facilities-service";
import type { Facility } from "@/lib/facilities/sample-data";
import "./facilities.css";

const facilities = getFacilities();
const types: Facility["type"][] = ["Lecture Room", "Computer Lab", "Laboratory"];
const statuses: Facility["status"][] = ["Available", "In Use", "Maintenance"];

export default function FacilitiesPage() {
  const [search, setSearch] = useState("");
  const [building, setBuilding] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<Facility | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const buildings = useMemo(() => [...new Set(facilities.map((item) => item.building))].sort(), []);
  const summary = useMemo(() => ({
    total: facilities.length,
    available: facilities.filter((item) => item.status === "Available").length,
    maintenance: facilities.filter((item) => item.status === "Maintenance").length,
    capacity: facilities.reduce((total, item) => total + item.capacity, 0),
  }), []);
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return facilities.filter((item) =>
      (building === "ALL" || item.building === building) &&
      (type === "ALL" || item.type === type) &&
      (status === "ALL" || item.status === status) &&
      [item.code, item.name, item.building].some((value) => value.toLocaleLowerCase().includes(term))
    );
  }, [search, building, type, status]);

  function openDetails(item: Facility) {
    setSelected(item);
    dialogRef.current?.showModal();
  }

  function clearFilters() {
    setSearch("");
    setBuilding("ALL");
    setType("ALL");
    setStatus("ALL");
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
        <div className="facilities-section-heading"><div><p className="eyebrow">DIRECTORY</p><h2 id="directory-heading">Facilities</h2></div><p>Search and filter the sample directory.</p></div>
        <div className="facilities-filters">
          <label>Search rooms<input className="field" type="search" placeholder="Code, name, or building" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Building<select className="select" value={building} onChange={(event) => setBuilding(event.target.value)}><option value="ALL">All buildings</option>{buildings.map((value) => <option key={value}>{value}</option>)}</select></label>
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

      <dialog ref={dialogRef} className="facilities-dialog" aria-labelledby="facility-dialog-title" onClose={() => setSelected(null)}>
        {selected && <><div className="facilities-dialog-heading"><div><p className="eyebrow">FACILITY DETAILS</p><h2 id="facility-dialog-title">{selected.name}</h2><p>{selected.code}</p></div><button type="button" className="facilities-dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close facility details">×</button></div>
          <dl className="facilities-detail-grid"><div><dt>ID</dt><dd>{selected.id}</dd></div><div><dt>Room code</dt><dd>{selected.code}</dd></div><div><dt>Room name</dt><dd>{selected.name}</dd></div><div><dt>Building</dt><dd>{selected.building}</dd></div><div><dt>Floor</dt><dd>{selected.floor}</dd></div><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Capacity</dt><dd>{selected.capacity} seats</dd></div><div><dt>Status</dt><dd><span className={`facilities-badge facilities-badge-${selected.status.toLowerCase().replace(" ", "-")}`}>{selected.status}</span></dd></div><div className="facilities-equipment"><dt>Equipment</dt><dd><ul>{selected.equipment.map((equipment) => <li key={equipment}>{equipment}</li>)}</ul></dd></div></dl>
        </>}
      </dialog>
      <footer>UniSchedule AI · Fictional facilities demo</footer>
    </main>
  );
}
