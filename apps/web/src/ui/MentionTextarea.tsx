import type { ProfileContent } from "applesauce-core/helpers/profile";
import { ProfileModel } from "applesauce-core/models/profile";
import { useEventModel } from "applesauce-react/hooks/use-event-model";
import { nip19 } from "nostr-tools";
import {
  type KeyboardEvent,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type MentionReference = {
  token: string;
  pubkey: string;
};

type MentionCandidate = {
  pubkey: string;
  profile?: ProfileContent | undefined;
  displayName: string;
  handle: string;
};

type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

export function MentionTextarea({
  value,
  mentions,
  memberPubkeys,
  onValueChange,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  mentions: MentionReference[];
  memberPubkeys: string[];
  onValueChange: (value: string, mentions: MentionReference[]) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileContent | undefined>>({});
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = `${props.id ?? "comment"}-mention-menu`;
  const uniquePubkeys = useMemo(() => [...new Set(memberPubkeys)].sort(), [memberPubkeys]);
  const recordProfile = useCallback((pubkey: string, profile: ProfileContent | undefined) => {
    setProfiles((current) =>
      current[pubkey] === profile ? current : { ...current, [pubkey]: profile },
    );
  }, []);
  const candidates = useMemo(() => {
    const query = mentionQuery?.query.toLocaleLowerCase() ?? "";
    return uniquePubkeys
      .map((pubkey): MentionCandidate => {
        const profile = profiles[pubkey];
        return {
          pubkey,
          profile,
          displayName: profileDisplayName(profile, pubkey),
          handle: profileHandle(profile, pubkey),
        };
      })
      .filter(
        (candidate) =>
          !query ||
          candidate.displayName.toLocaleLowerCase().includes(query) ||
          candidate.handle.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [mentionQuery?.query, profiles, uniquePubkeys]);
  const menuOpen = Boolean(mentionQuery && candidates.length);

  useEffect(() => {
    if (activeIndex >= candidates.length) setActiveIndex(Math.max(0, candidates.length - 1));
  }, [activeIndex, candidates.length]);

  const selectCandidate = (candidate: MentionCandidate) => {
    if (!mentionQuery) return;
    const existing = mentions.find((mention) => mention.pubkey === candidate.pubkey);
    let token = existing?.token ?? `@${candidate.handle}`;
    if (
      mentions.some((mention) => mention.token === token && mention.pubkey !== candidate.pubkey)
    ) {
      token = `${token}_${candidate.pubkey.slice(0, 6)}`;
    }
    const nextValue = `${value.slice(0, mentionQuery.start)}${token} ${value.slice(mentionQuery.end)}`;
    const nextMentions = existing ? mentions : [...mentions, { token, pubkey: candidate.pubkey }];
    const nextCursor = mentionQuery.start + token.length + 1;
    onValueChange(nextValue, nextMentions);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % candidates.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const candidate = candidates[activeIndex];
      if (candidate) selectCandidate(candidate);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMentionQuery(null);
    }
  };

  return (
    <div className="relative">
      {uniquePubkeys.map((pubkey) => (
        <ProfileObserver key={pubkey} pubkey={pubkey} onChange={recordProfile} />
      ))}
      <textarea
        {...props}
        ref={textareaRef}
        className={className}
        value={value}
        aria-autocomplete="list"
        aria-controls={menuOpen ? menuId : undefined}
        aria-activedescendant={menuOpen ? `${menuId}-${activeIndex}` : undefined}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextMentions = mentions.filter((mention) => nextValue.includes(mention.token));
          onValueChange(nextValue, nextMentions);
          setMentionQuery(findMentionQuery(nextValue, event.target.selectionStart));
          setActiveIndex(0);
        }}
        onClick={(event) => {
          setMentionQuery(findMentionQuery(value, event.currentTarget.selectionStart));
          setActiveIndex(0);
        }}
        onKeyUp={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
          setMentionQuery(findMentionQuery(value, event.currentTarget.selectionStart));
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setMentionQuery(null)}
      />
      {menuOpen ? (
        <div
          id={menuId}
          role="listbox"
          aria-label="Board members"
          className="panel absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto p-1 shadow-[var(--shadow)]"
        >
          {candidates.map((candidate, index) => (
            <button
              key={candidate.pubkey}
              id={`${menuId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-2 text-left text-sm ${index === activeIndex ? "bg-[var(--accent-soft)]" : "bg-transparent hover:bg-[var(--panel-strong)]"}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                selectCandidate(candidate);
              }}
            >
              {candidate.profile?.picture ? (
                <img
                  src={candidate.profile.picture}
                  alt=""
                  className="size-7 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--sidebar)] text-[10px] font-bold">
                  {candidate.displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <strong className="block truncate">{candidate.displayName}</strong>
                <span className="block truncate text-xs text-[var(--faint)]">
                  @{candidate.handle}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function encodeNostrMentions(value: string, mentions: MentionReference[]): string {
  return [...mentions]
    .sort((left, right) => right.token.length - left.token.length)
    .reduce((content, mention) => {
      const pattern = new RegExp(`${escapeRegExp(mention.token)}(?![\\p{L}\\p{N}_-])`, "gu");
      return content.replace(pattern, `nostr:${nip19.npubEncode(mention.pubkey)}`);
    }, value);
}

function ProfileObserver({
  pubkey,
  onChange,
}: {
  pubkey: string;
  onChange: (pubkey: string, profile: ProfileContent | undefined) => void;
}) {
  const profile = useEventModel(ProfileModel, [pubkey]);
  useEffect(() => onChange(pubkey, profile), [onChange, profile, pubkey]);
  return null;
}

function findMentionQuery(value: string, cursor: number | null): MentionQuery | null {
  if (cursor === null) return null;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: cursor - query.length - 1, end: cursor, query };
}

function profileDisplayName(profile: ProfileContent | undefined, pubkey: string): string {
  return profile?.display_name?.trim() || profile?.name?.trim() || shortNpub(pubkey);
}

function profileHandle(profile: ProfileContent | undefined, pubkey: string): string {
  const label = profile?.name?.trim() || profile?.display_name?.trim() || shortNpub(pubkey);
  return label.replace(/^@/u, "").replace(/\s+/gu, "_");
}

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
