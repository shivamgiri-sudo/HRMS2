import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'hrms_quick_links';
const MAX_LINKS = 8;

export interface QuickLink {
  href: string;
  label: string;
  description?: string;
  addedAt: number;
}

export function useQuickLinks() {
  const [links, setLinks] = useState<QuickLink[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as QuickLink[];
        setLinks(Array.isArray(parsed) ? parsed.slice(0, MAX_LINKS) : []);
      }
    } catch {
      setLinks([]);
    }
  }, []);

  // Persist to localStorage
  const persist = useCallback((newLinks: QuickLink[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLinks));
    } catch {
      // localStorage quota exceeded or unavailable
    }
  }, []);

  const addLink = useCallback((link: Omit<QuickLink, 'addedAt'>) => {
    setLinks((prev) => {
      // Don't add duplicates
      if (prev.some((l) => l.href === link.href)) return prev;
      // Enforce max
      const newLinks = [{ ...link, addedAt: Date.now() }, ...prev].slice(0, MAX_LINKS);
      persist(newLinks);
      return newLinks;
    });
  }, [persist]);

  const removeLink = useCallback((href: string) => {
    setLinks((prev) => {
      const newLinks = prev.filter((l) => l.href !== href);
      persist(newLinks);
      return newLinks;
    });
  }, [persist]);

  const hasLink = useCallback((href: string) => {
    return links.some((l) => l.href === href);
  }, [links]);

  const reorderLinks = useCallback((fromIndex: number, toIndex: number) => {
    setLinks((prev) => {
      const newLinks = [...prev];
      const [removed] = newLinks.splice(fromIndex, 1);
      newLinks.splice(toIndex, 0, removed);
      persist(newLinks);
      return newLinks;
    });
  }, [persist]);

  return {
    links,
    addLink,
    removeLink,
    hasLink,
    reorderLinks,
    maxLinks: MAX_LINKS,
  };
}
