# Redesign brief (the founder, 27 Nov 2026)

The founder's brief, kept word for word except that the product name is FeedYourBusiness throughout and dashes are written as hyphens (docs rules). The reference screenshots it mentions are not in the repo. Where it conflicts with docs/PLAN.md section 2 or .claude/rules/, the rules win; see docs/PLAN.md section 9 for what was adopted.

---

Build a complete public homepage and logged-in product interface for my business, FeedYourBusiness.

This is a standalone brief. Do not assume any previous prompts have been implemented.

Use the two attached screenshots as visual references:

1. The light Ownfeed page: inspiration for the public website’s whitespace, typography, rounded navigation, spacious cards, and restrained black-and-white design.
2. The dark Ownfeed application: inspiration for the logged-in product’s sidebar, dark surfaces, rounded main panel, and minimal interface.

Do not copy Ownfeed’s name, mascot, exact copy, or brand identity.

My product is called FeedYourBusiness.
Use that name consistently throughout the website and application.

WHAT THE PRODUCT DOES

FeedYourBusiness finds public conversations about the problem a founder’s product solves.

It helps the user:

- Discover relevant conversations.
- Read the original question or discussion.
- Understand why a conversation matches their product.
- Open the original conversation and reply personally.

Users write their own replies and disclose that they built the product.

Do not position FeedYourBusiness as an automated spam tool, automatic reply bot, or a guarantee of customers.

FIRST: INSPECT THE EXISTING PROJECT

Before making changes:

- Identify the framework, existing routes, components, authentication, billing, and integrations.
- Reuse the project’s existing stack and conventions.
- Preserve working functionality.
- Use real application data wherever available.
- Do not replace working backend connections with mock content.
- Verify supported platforms, pricing, trial duration, and access rules.

If functionality is missing, clearly identify it rather than creating controls that falsely appear to work.

CORE DESIGN AND CONVERSION PRINCIPLES

Apply these principles to the actual design and copy, not just the implementation summary.

1. CLARITY BEFORE CLEVERNESS

Make it immediately clear:

- What FeedYourBusiness does.
- Who it is for.
- What users receive.
- What they should do next.

Use specific, straightforward language.

Avoid vague headlines such as:
“Supercharge your growth.”
“Your AI business companion.”
“The future of customer acquisition.”

2. SHOW THE PRODUCT EARLY

Place a readable product demonstration near the hero.

Show an example conversation and its match explanation so visitors can understand the value before signing up.

Use genuine product content when available.
Clearly label invented examples “Illustrative example”.

3. ONE PRIMARY CONVERSION GOAL

Choose one main signup action based on the actual access model.

Use the same primary action in:

- Navigation.
- Hero.
- Pricing.
- Final call to action.

Keep “See an example” and other supporting actions visually secondary.

4. REDUCE UNCERTAINTY

Explain what happens after clicking.

Place important billing and access details close to the relevant CTA:

- Trial price.
- Trial duration.
- Renewal amount.
- Billing frequency.
- Cancellation method.
- Invitation requirements, if applicable.

Never combine “Start now” messaging with an unexplained invitation-only restriction.

5. BUILD TRUST WITH SPECIFICITY

Use:

- Real product demonstrations.
- Clear explanations.
- Accurate pricing.
- Honest limitations.
- Genuine customer proof only when available.

Do not invent:

- Testimonials.
- Customer logos.
- User counts.
- Revenue figures.
- Guaranteed results.
- Fake urgency.
- Artificial scarcity.

6. USE VISUAL HIERARCHY

Guide attention through:

- Strong headings.
- Readable copy.
- Generous spacing.
- Consistent buttons.
- Clear contrast.
- Quiet secondary actions.

Do not assume a particular colour automatically increases conversions.

7. KEEP THE PRODUCT EASY TO EVALUATE

Explain the workflow in three simple steps.
Let visitors inspect an example without signing up.
Answer practical objections in an FAQ.

OVERALL VISUAL DIRECTION

Create two complementary surfaces:

PUBLIC WEBSITE
Bright, minimal, spacious, and predominantly white.

LOGGED-IN APPLICATION
Dark, calm, organised, and focused.

Connect both through:

- Consistent typography.
- Shared spacing.
- Similar button shapes.
- Matching icon styles.
- Consistent FeedYourBusiness branding.

Use a clean sans-serif font such as Geist, Inter, or an appropriate existing project font.

Suggested colours:

Public website:

- Background: #FFFFFF
- Secondary surface: #F7F7F5
- Main text: #101010
- Secondary text: #707076
- Primary buttons: #101010 with white text

Application:

- Outer background: #0B0B0C
- Main surface: #161617
- Elevated surface: #202022
- Main text: #F5F5F5
- Secondary text: #A1A1AA
- Borders: #2A2A2E

Use:

- Large, confident headings.
- Rounded cards.
- Fine borders.
- Restrained shadows.
- Simple line icons.
- Comfortable spacing.

Avoid:

- Purple gradients.
- Glassmorphism.
- Stock photography.
- Generic AI sparkle graphics.
- Decorative charts.
- Excessive animation.
- Crowded dashboards.
- Tiny, unreadable product screenshots.

Create an original, simple FeedYourBusiness brand mark suggesting a feed or conversation.
Do not recreate Ownfeed’s ghost mascot.

PAGE 1: PUBLIC HOMEPAGE

NAVIGATION

Create a centred, rounded, pale-grey navigation container inspired by the light reference.

Left:
FeedYourBusiness logo and wordmark.

Centre:
How it works
Example
Pricing

Right:
Sign in
Primary signup button

Keep the navigation clean and responsive.

HERO

Eyebrow:
“FOR FOUNDERS DOING THEIR OWN MARKETING”

Headline:
“Find people already asking for what you built.”

Supporting copy:
“FeedYourBusiness finds public conversations about the problem your product solves. See why each one matches, then reply in your own words.”

Primary CTA:
Use the real access model.

If immediate trial signup is available:
“Start your trial”

If invitation-only:
“Request an invite”

Secondary action:
“See an example”

Make the secondary action scroll to the product demonstration.

Place verified pricing and access terms immediately beneath the main action.

PRICING VERIFICATION

Provisional business details to check against the existing project:
£1 for 3 days, then £39/month.

These are not instructions to change existing billing configuration.

If the configured pricing differs:

- Preserve the actual configuration.
- Use verified pricing in the interface.
- Flag the discrepancy in your implementation summary.

Do not copy the reference website’s dollar amounts, one-day trial, or quarterly plan.

Do not describe a paid trial as free.

If invitation-only:
Explain that the trial becomes available once invited.

HERO PRODUCT PREVIEW

Place a large, readable preview of the dark FeedYourBusiness application beside or directly below the hero.

Show:

- A compact sidebar.
- A Today heading.
- One complete conversation card.
- A match explanation.
- View conversation.
- Save.
- Hide.

Use enough scale that visitors can actually read it.

If using invented content, label it:
“Illustrative example”

Example conversation:
“Does anyone know a tool that chases late invoices for me? I am tired of writing reminder emails every week.”

Example source:
“Reddit · r/freelance”

Example explanation:
“They are asking for a tool that sends invoice reminders.”

This example represents a hypothetical invoice-reminder product using FeedYourBusiness.
Do not imply that FeedYourBusiness sends invoice reminders.

Do not imply a source integration is live unless verified.

Use a “Strong match” badge only if the product actually provides that classification.
Otherwise use the neutral heading:
“Why it matched”

Supporting line:
“You decide whether you can help. You write every reply.”

HOW IT WORKS

Heading:
“Less searching. More useful conversations.”

Three cards:

1. Describe your product
   “Tell FeedYourBusiness what you built and the problem it solves.”

2. Review relevant conversations
   “Read the original question and see why it matches.”

3. Reply as yourself
   “Open the conversation, be helpful, and say you built it.”

Keep this section concise and visually simple.

PRODUCT VALUE SECTION

Heading:
“A reason to reply. Not another feed to scroll.”

Supporting copy:
“See the question and the reason it matched, so you can decide whether your product is genuinely relevant.”

Three points:

- Read the original context.
- Understand the match.
- Choose whether to reply.

Pair this with a larger conversation example.

Clearly separate:

- Original conversation text.
- FeedYourBusiness’s explanation.
- User actions.

Do not suggest that everyone discussing a problem is ready to buy.

PRICING SECTION

Heading:
“Clear pricing. No surprises.”

Use spacious, rounded pricing cards inspired by the light reference.

Only show plans that actually exist.

For any trial, display:

- What is charged today.
- Trial duration.
- Renewal amount.
- Billing frequency.
- When recurring billing begins.
- How to cancel.

Keep these details readable.
Do not hide material conditions in faint, tiny text.

Use the same main CTA as the hero.

Do not invent discounts, quarterly billing, annual plans, or premium features.

FAQ

Include:

“What does FeedYourBusiness do?”
Explain conversation discovery and match explanations.

“Does it send replies for me?”
“No. You open the original conversation and reply in your own words. Be helpful and disclose that you built the product.”

“Which platforms does it support?”
List only verified sources.
Clearly distinguish live integrations from beta or planned support.

“How does the trial work?”
Use verified billing terms.

“How do I cancel?”
Describe the actual implemented cancellation process.

“Will every conversation be a perfect match?”
Explain that users should review the context and decide whether their product is relevant.

FINAL CTA

Heading:
“Find your next useful conversation.”

Supporting copy:
“See where people are discussing the problem your product solves.”

Repeat the same primary action and essential access or billing disclosure.

FOOTER

Include:
FeedYourBusiness wordmark
Privacy
Terms
Contact
Sign in

Use working destinations.

PAGE 2: LOGGED-IN PRODUCT

APP GOAL

Deliver on the homepage promise:
Show relevant conversations, explain why they match, and make the next action clear.

Use the dark screenshot’s visual restraint, but create a complete content area rather than a blank panel.

APP SHELL

Desktop:

- Persistent sidebar approximately 240-260px wide.
- Almost-black outer background.
- Large, subtly lighter main content panel.
- Rounded main panel corners.
- Comfortable padding.
- Readable feed width.

SIDEBAR

Top:
FeedYourBusiness logo and wordmark.

Primary navigation:

- Today
- All conversations
- Saved
- Hidden

Lower navigation:

- Product
- Settings

Account controls near the bottom.

Only include Analytics, Keywords, custom views, or additional sections if those features exist.

Use monochrome line icons and a rounded active state.
Do not create dead navigation links.

TODAY PAGE

Heading:
“Today”

Subtitle:
“Conversations worth a closer look.”

Display real result counts and update times only when available.

Provide distinct states for:

- Loading.
- Results.
- No conversations.
- No results for selected filters.
- Integration errors.
- Server errors.

Do not leave the main content area blank while loading indefinitely.

FILTERS

Only include filters supported by real data.

Possible filters:

- Source.
- Relevance.
- Saved status.

Keep filters compact and secondary to the conversations.

CONVERSATION FEED

Use a readable single-column feed rather than a dense grid.

Each card should show, where available:

- Source.
- Community.
- Author.
- Original posting time.
- Original title or question.
- Enough text to understand the context.
- Match explanation.
- Genuine relevance classification, if supported.

Primary action:
“View conversation”

Secondary actions:
Save
Hide

Make original content visually distinct from FeedYourBusiness’s explanation.

Do not fabricate confidence percentages, engagement counts, or summaries that the system does not provide.

Save and Hide must persist through the actual backend.

Show accessible feedback when an action succeeds or fails.
Allow undo where practical.

CONVERSATION DETAIL

Show:

- Full available conversation context.
- Source attribution.
- Match explanation.
- Original conversation link.
- Save and Hide controls.

Use a desktop side panel or dedicated page consistent with the existing architecture.

On mobile, use a full-screen detail view.

Do not add automatic posting or reply-generation features unless explicitly supported and required.

PRODUCT PROFILE

Use the existing product setup or editing flow.

Where supported, let users review:

- Product name.
- Website.
- What the product does.
- The problem it solves.
- Who it is for.

Explain how this information informs matching without promising perfect results.

Do not add fields that are not saved or used.

EMPTY STATES

No conversations:
“No conversations to show yet.”
“Check that your product description clearly explains the problem you solve.”
Action: “Review product”

Do not use this state to hide an integration or server error.

Saved:
“Your saved conversations will appear here.”

Hidden:
“Conversations you hide will appear here.”

Filtered results:
“No conversations match these filters.”
Action: “Clear filters”

Errors:
Explain that something went wrong and provide a working retry action where appropriate.

RESPONSIVE BEHAVIOUR

Desktop:
Persistent sidebar and spacious content.

Tablet:
Collapsible or compact sidebar.

Mobile:
Navigation drawer.
Single-column cards.
Comfortable touch targets.
Readable text.
No horizontal scrolling.
Compact filter drawer or sheet.

The public homepage should stack naturally on smaller screens without making the product preview unreadable.

ACCESSIBILITY

- Semantic headings and landmarks.
- Readable contrast.
- Visible keyboard focus.
- Labels for icon-only controls.
- Keyboard-accessible navigation and dialogs.
- Reduced-motion support.
- Do not rely on colour alone for meaning.

IMPLEMENTATION REQUIREMENTS

Build reusable:

- Buttons.
- Cards.
- Badges.
- Navigation items.
- Filter controls.
- Conversation cards.
- Match explanation blocks.
- Loading states.
- Empty states.
- Error states.

Keep light marketing styles and dark app styles properly scoped.

Preserve:

- Authentication.
- Billing.
- Integrations.
- Existing user data.
- Routing compatibility.

Do not ship:

- Fake activity.
- Fake integrations.
- Nonfunctional controls.
- Unlabelled mock data.
- Broken links.
- Misleading billing claims.

TESTING

Verify:

- Signup and sign-in.
- Main CTA destinations.
- Pricing disclosures.
- Billing links.
- External conversation links.
- Save and Hide persistence.
- Filters.
- Mobile navigation.
- Loading, empty, and error states.
- Keyboard accessibility.

MEASUREMENT

If analytics exist, preserve them.

Where appropriate, track:

- Primary CTA clicked.
- Example viewed.
- Signup completed.
- First conversation opened.
- First conversation saved.

Avoid duplicate events.
Do not include conversation text or personal data in analytics payloads.

Do not claim conversion improvements without measurement.

DELIVERABLE

Implement the public homepage and logged-in application.

After implementation, summarise:

- What changed.
- Which existing functionality was preserved.
- How clarity, product demonstration, focused attention, and transparent terms shaped the design.
- Any unverified pricing or platform details.
- Any remaining backend requirements.

FINAL QUALITY STANDARD

The homepage should make FeedYourBusiness easy to understand and evaluate, with one clear next step.

The product should fulfil that promise through a focused conversation feed, useful match explanations, and clear manual actions.

Use the screenshots as visual inspiration while creating an original, cohesive FeedYourBusiness identity.
