import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Star, Plus, Search, X, Zap, ArrowRight, Trash2, Sparkles,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { useQuickLinks, type QuickLink } from '@/hooks/useQuickLinks';
import { navGroups } from '@/components/layout/navConfig';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  description?: string;
  children?: NavItem[];
}

// Flatten all nav items for search
function flattenNavItems(): NavItem[] {
  const items: NavItem[] = [];

  function traverse(navItems: NavItem[]) {
    for (const item of navItems) {
      if (item.href && item.label) {
        items.push({
          label: item.label,
          href: item.href,
          description: item.description,
        });
      }
      if (item.children) {
        traverse(item.children);
      }
    }
  }

  for (const group of navGroups) {
    traverse(group.items as NavItem[]);
  }

  // Remove duplicates by href
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

const ALL_PAGES = flattenNavItems();

// Inline gradient styles for chips — avoids Tailwind purge of dynamic from-*/to-* classes
const CHIP_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6, #4f46e5)',
  'linear-gradient(135deg, #a855f7, #7c3aed)',
  'linear-gradient(135deg, #10b981, #0d9488)',
  'linear-gradient(135deg, #f59e0b, #ea580c)',
  'linear-gradient(135deg, #ec4899, #e11d48)',
  'linear-gradient(135deg, #06b6d4, #3b82f6)',
  'linear-gradient(135deg, #6366f1, #a855f7)',
  'linear-gradient(135deg, #14b8a6, #10b981)',
];

function getChipStyle(index: number): React.CSSProperties {
  return { background: CHIP_GRADIENTS[index % CHIP_GRADIENTS.length] };
}

// Search dialog component (shared)
function QuickLinksSearchDialog({
  open,
  onOpenChange,
  links,
  addLink,
  removeLink,
  hasLink,
  maxLinks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: QuickLink[];
  addLink: (link: Omit<QuickLink, 'addedAt'>) => void;
  removeLink: (href: string) => void;
  hasLink: (href: string) => boolean;
  maxLinks: number;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSearch('');
    }
  }, [open]);

  const filteredPages = useMemo(() => {
    if (!search.trim()) return ALL_PAGES.slice(0, 15);
    const q = search.toLowerCase();
    return ALL_PAGES.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.href.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            Add Quick Link
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              ref={inputRef}
              placeholder="Search pages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 rounded-xl"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1">
            {filteredPages.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">
                No pages found for "{search}"
              </p>
            ) : (
              filteredPages.map((page) => {
                const added = hasLink(page.href);
                return (
                  <div
                    key={page.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150',
                      added
                        ? 'bg-indigo-50 border border-indigo-200'
                        : 'hover:bg-slate-50 border border-transparent'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {page.label}
                      </p>
                      {page.description && (
                        <p className="text-[11px] text-slate-500 truncate">
                          {page.description}
                        </p>
                      )}
                    </div>
                    {added ? (
                      <button
                        onClick={() => removeLink(page.href)}
                        className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    ) : (
                      <button
                        onClick={() => addLink({
                          href: page.href,
                          label: page.label,
                          description: page.description,
                        })}
                        disabled={links.length >= maxLinks}
                        className={cn(
                          'flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors cursor-pointer',
                          links.length >= maxLinks
                            ? 'text-slate-400 cursor-not-allowed'
                            : 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50'
                        )}
                      >
                        <Plus className="h-3 w-3" />
                        Add
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {links.length >= maxLinks && (
            <p className="text-[11px] text-amber-600 text-center py-1">
              Maximum {maxLinks} quick links reached. Remove one to add more.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline Quick Links Bar - thin horizontal row for header placement
 * This is the PRIMARY component for dashboard headers
 */
export function QuickLinksBar() {
  const { links, addLink, removeLink, hasLink, maxLinks } = useQuickLinks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);

  return (
    <>
      <div className="flex items-center gap-2 py-2 px-1 overflow-x-auto scrollbar-thin">
        {/* Quick Links label */}
        <div className="flex items-center gap-1.5 text-slate-500 shrink-0">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">Quick Links</span>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-slate-200 shrink-0" />

        {/* Link chips */}
        {links.map((link, index) => (
          <Link
            key={link.href}
            to={link.href}
            onMouseEnter={() => setHoveredLink(link.href)}
            onMouseLeave={() => setHoveredLink(null)}
            style={getChipStyle(index)}
            className="group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all duration-200 cursor-pointer shrink-0 shadow-sm hover:shadow-md hover:scale-[1.02]"
          >
            {link.label}
            <ArrowRight className="h-3 w-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />

            {/* Remove button on hover */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeLink(link.href);
              }}
              className={cn(
                'absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-sm',
                hoveredLink === link.href ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
              )}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Link>
        ))}

        {/* Add button */}
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all cursor-pointer shrink-0"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      <QuickLinksSearchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        links={links}
        addLink={addLink}
        removeLink={removeLink}
        hasLink={hasLink}
        maxLinks={maxLinks}
      />
    </>
  );
}

/**
 * Original card-style widget (kept for backwards compatibility)
 */
export function QuickLinksWidget() {
  const { links, addLink, removeLink, hasLink, maxLinks } = useQuickLinks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);

  const handleRemove = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    e.stopPropagation();
    removeLink(href);
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Quick Links</h3>
            <p className="text-[10px] text-white/70">{links.length}/{maxLinks} shortcuts</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDialogOpen(true)}
          className="h-7 text-xs text-white/90 hover:text-white hover:bg-white/20 cursor-pointer gap-1 px-2"
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Quick Links Grid */}
      <div className="p-3">
        {links.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-3">
              <Star className="h-5 w-5 text-indigo-500" />
            </div>
            <p className="text-sm font-semibold text-slate-700">No quick links yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
              Add your frequently visited pages for quick access
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
              className="mt-3 h-8 text-xs cursor-pointer border-indigo-200 text-indigo-600 hover:bg-indigo-50"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Quick Link
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {links.map((link, index) => {
              const isHovered = hoveredLink === link.href;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  onMouseEnter={() => setHoveredLink(link.href)}
                  onMouseLeave={() => setHoveredLink(null)}
                  style={getChipStyle(index)}
                  className="group relative rounded-xl p-3 transition-all duration-200 cursor-pointer overflow-hidden hover:shadow-lg hover:scale-[1.02]"
                >
                  <button
                    onClick={(e) => handleRemove(e, link.href)}
                    className={cn(
                      'absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-black/20 hover:bg-black/40 flex items-center justify-center transition-all cursor-pointer',
                      isHovered ? 'opacity-100' : 'opacity-0'
                    )}
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>

                  <div className="flex flex-col h-full min-h-[52px]">
                    <p className="text-xs font-bold text-white leading-tight line-clamp-2">
                      {link.label}
                    </p>
                    <div className="mt-auto pt-1.5 flex items-center justify-between">
                      <span className="text-[9px] text-white/60 font-medium truncate max-w-[80%]">
                        {link.description || 'Quick access'}
                      </span>
                      <ArrowRight className={cn(
                        'h-3 w-3 text-white/70 transition-transform duration-200',
                        isHovered && 'translate-x-0.5'
                      )} />
                    </div>
                  </div>
                </Link>
              );
            })}

            {links.length < maxLinks && links.length < 8 && (
              <button
                onClick={() => setDialogOpen(true)}
                className="rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 p-3 min-h-[52px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer hover:bg-indigo-50/50"
              >
                <Plus className="h-4 w-4 text-slate-400" />
                <span className="text-[10px] font-medium text-slate-500">Add</span>
              </button>
            )}
          </div>
        )}
      </div>

      <QuickLinksSearchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        links={links}
        addLink={addLink}
        removeLink={removeLink}
        hasLink={hasLink}
        maxLinks={maxLinks}
      />
    </div>
  );
}

// Compact version for smaller spaces
export function QuickLinksCompact() {
  const { links, removeLink } = useQuickLinks();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
        <Zap className="h-3 w-3" />
        Quick:
      </span>
      {links.slice(0, 4).map((link) => (
        <Link
          key={link.href}
          to={link.href}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors cursor-pointer"
        >
          {link.label}
        </Link>
      ))}
      {links.length > 4 && (
        <span className="text-xs text-slate-400">+{links.length - 4} more</span>
      )}
    </div>
  );
}
