"use client";

import { Command, defaultFilter } from "cmdk";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

export type CommandEntry = {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  keywords?: string[];
  run: () => void;
};

export type CommandSection = { heading: string; items: CommandEntry[] };

const itemValue = (section: CommandSection, item: CommandEntry) => `${section.heading}:${item.id}`;
const itemKeywords = (item: CommandEntry) => [item.label, ...(item.keywords ?? [])];

/** ⌘K menu built on cmdk: fuzzy matching, grouped results and full keyboard control. */
export function CommandMenu({
  open,
  onOpenChange,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: CommandSection[];
}) {
  const [search, setSearch] = useState("");

  // cmdk 1.1 sorts items inside a group but cannot reorder the groups themselves, so the section
  // holding the best match is moved first here, scored with cmdk's own filter.
  const ordered = useMemo(() => {
    const query = search.trim();
    if (!query) return sections;
    return sections
      .map((section) => ({
        section,
        best: Math.max(0, ...section.items.map((item) => defaultFilter(itemValue(section, item), query, itemKeywords(item)))),
      }))
      .sort((a, b) => b.best - a.best)
      .map(({ section }) => section);
  }, [sections, search]);

  function setOpen(next: boolean) {
    if (!next) setSearch("");
    onOpenChange(next);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      loop
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-dialog"
    >
      <div className="cmdk-input">
        <Search size={16} aria-hidden="true" />
        <Command.Input value={search} onValueChange={setSearch} placeholder="Jump to a view, agent, user or model…" />
        <kbd>esc</kbd>
      </div>
      <Command.List className="cmdk-list">
        <Command.Empty className="cmdk-empty">No matches.</Command.Empty>
        {ordered
          .filter((section) => section.items.length)
          .map((section) => (
            <Command.Group key={section.heading} heading={section.heading}>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.id}
                    value={itemValue(section, item)}
                    keywords={itemKeywords(item)}
                    onSelect={() => {
                      setOpen(false);
                      item.run();
                    }}
                  >
                    {Icon ? <Icon size={15} strokeWidth={1.6} aria-hidden="true" /> : <span className="cmdk-dot" />}
                    <span className="cmdk-label">{item.label}</span>
                    {item.hint && <span className="cmdk-hint">{item.hint}</span>}
                    <CornerDownLeft className="cmdk-enter" size={13} aria-hidden="true" />
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
      </Command.List>
    </Command.Dialog>
  );
}
