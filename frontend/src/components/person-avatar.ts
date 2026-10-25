/**
 * A person's round badge (D-034): their picture when Home Assistant serves it, else their
 * initials, on their colour. Used by the names over the figures, the person's sheet and the room
 * panel.
 */
import { css, html, type TemplateResult } from "lit";

import type { PersonShown } from "../live/people";

export const avatarStyles = css`
  .avatar {
    flex: none;
    width: 1.75em;
    height: 1.75em;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    overflow: hidden;
    background: var(--person, #888);
    color: #fff;
    font-size: 0.75em;
    font-weight: 700;
    letter-spacing: 0.02em;
    box-shadow: 0 0 0 2px var(--person, #888);
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar.big {
    width: 3em;
    height: 3em;
    font-size: 1em;
  }
`;

export function avatar(person: PersonShown, big = false): TemplateResult {
  return html`<span
    class="avatar ${big ? "big" : ""}"
    style="--person:${person.color}"
    aria-hidden="true"
    >${
      person.picture
        ? html`<img src=${person.picture} alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : person.initials
    }</span
  >`;
}
