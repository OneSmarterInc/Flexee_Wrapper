# Chapter 6. Numbers, and the decisions people make because of them

## What counts as a hit?

Somewhere in baseball's development, someone had to decide what counted as a hit.

A batter who puts the ball safely into the outfield has clearly done something useful. A batter who is awarded a walk has also done something useful: reached first base without being put out. If you do not follow baseball, that is enough to begin. Teams try to score runs by moving players around the bases before the other side records enough outs to end their turn.

Batting average counts hits divided by at-bats. Walks are excluded. That is a definition, not a discovery. It describes one part of a batter's contribution. It does not describe everything that helps a team score. [MLB's batting-average definition](https://www.mlb.com/glossary/standard-stats/batting-average).

Now notice what can happen when money is attached to a measure. If teams rely too heavily on hitting when valuing players, a player who contributes in other ways may be underpriced. Not undiscovered: visible, playable, on the field every day, but worth more to a team than the usual evaluation suggests.

That is the central idea in the Moneyball story. Oakland's front office looked for useful contributions that the player market did not adequately reward. On-base percentage includes walks and hit-by-pitches as well as hits, giving a different view of offensive contribution. [MLB's on-base-percentage definition](https://www.mlb.com/glossary/standard-stats/on-base-percentage).

The memorable question is not whether one number is always better than another. It is what the team is trying to accomplish, and which measure helps it choose players who can accomplish it at an affordable price.

Oakland's 2002 season included 103 wins and a twenty-game winning streak. [MLB's account of the season](https://www.mlb.com/news/art-howe-recalls-athletics-20-game-win-streak-c254298012). Those results do not prove that one statistic explains a season. Players contribute in several ways, and a winning team is more than a purchasing formula. The story gives us a question worth investigating, not permission to stop investigating.

Research by Jahn Hakes and Raymond Sauer found evidence supporting the broader mispricing argument and evidence that the market corrected as the knowledge spread. That is a more useful conclusion than saying nobody had valued walks or that analytics eventually became worthless. [An Economic Evaluation of the Moneyball Hypothesis](https://www.aeaweb.org/articles?id=10.1257/jep.20.3.173).

An insight that rivals learn can lose its pricing advantage. The ability to keep asking better questions may still matter. Chapter 5 showed why accumulated capability can take time to copy; this chapter asks whether that capability is producing numbers fit for the decisions people make.

## Three answers to one question

A director needs the customer number for a board presentation. In this fictional company, marketing says 240,000, finance says 180,000 and support says 310,000.

Marketing counts people active in the last twelve months. Finance counts billing accounts. Support counts people who have ever contacted the company. A household with two people and three subscriptions can appear as one customer, two or three, depending on the question.

The numbers disagree before anyone has made an arithmetic error. They may still contain errors, but first you need to establish whether they are supposed to agree.

Figure 6.1 reduces that problem to four fictional records. Each row describes one subscription. “Active” means that its named person used that subscription during the last twelve months. “Ever contacted support” means that person contacted support about that subscription at least once. All records are viewed at the same reporting date.

*Figure 6.1 — One file, several valid counts. Count the entity the decision concerns, using a stated period and rule.*

| Person | Billing account | Subscription | Active in last 12 months | Ever contacted support |
|---|---|---|---|---|
| P01 | A10 | S100 | Yes | Yes |
| P01 | A10 | S101 | Yes | No |
| P02 | A10 | S102 | Yes | Yes |
| P03 | A20 | S103 | No | Yes |

*Fictional records. Totals: 3 people; 2 billing accounts; 4 subscriptions; 2 active people; 3 people with support contact.*

Start with the easiest count. There are four subscriptions because there are four different subscription identifiers. There are only three people because P01 appears twice. There are two billing accounts because the first three subscriptions share A10.

The thing you are counting is called an entity: here, a person, an account or a subscription. Its identifier lets you recognise it when it appears in more than one record. Counting rows answers the customer question only if each row represents exactly one customer under your chosen definition.

P01's second appearance is not a duplicate record to delete. It is another subscription belonging to the same person. Deleting it would lose useful information. When counting people, count P01 once; when counting subscriptions, retain both. Removing duplicate counting and removing records are different operations.

Now count active people. Three rows say Yes, but those rows belong to P01 and P02. The answer is two. Count people with any support contact and the answer is three: P01, P02 and P03. P01 qualifies even though one of that person's subscriptions has no recorded contact.

You have just done the central work of the example without a database command: choose the entity, apply the condition and count each qualifying entity once.

In a business, these records may sit in a database: an organised collection of data managed so it can be stored, retrieved and updated. Person, account and subscription details can be kept in related tables, connected by their identifiers. Figure 6.1 brings those relationships into one view for the exercise.

A query is a specified request for data. It can select records, combine related information or calculate a result. “Count distinct people with activity in the last twelve months” is the business question a query must express correctly. The computer needs the definition; it cannot choose the manager's meaning of customer.

A report presents selected results. A dashboard brings measures together for monitoring. Neither is necessarily the live operational record. If an account is corrected at noon but the dashboard refreshes overnight, the screen may still show yesterday's position. Before acting, ask what records supplied the number, which rules selected them and when the result was last updated. A polished display does not answer those questions by itself.

## Which number belongs in the presentation?

Suppose the director wants to describe how many people used the service during the last twelve months. Two is the right count in this small file. A useful label would be: “Distinct people with recorded use on at least one subscription during the twelve months ending on the reporting date.” In a real presentation, replace “the reporting date” with the actual date.

If the decision is how many billing accounts need a statement, two may again be the answer, but for a different reason. The identical result does not make the definitions interchangeable. Here, assume each listed account receives one statement. The records do not establish the company's actual billing rules.

If the question is how many support agents to schedule next month, none of these totals is enough. Three people have contacted support at some point in their lives as customers. That does not tell you how many requests will arrive next month, how difficult they will be, or when they will arrive. You need recent contact volumes, handling work and expected changes in demand.

State which question the number answers, and whether it is the question the decision requires.

An organisation can agree on shared definitions without forcing every department to use the same count for every purpose. Marketing and finance need to recognise the same person and account, but they do not need to pretend a person and an account are the same thing.

Someone must own those definitions and the process for changing them. If “active” changes from any use to paid use, the report should say so. Otherwise next month's apparent fall in customers may be a change in counting rather than a change in the business.

The technology can apply a definition consistently and distribute the result quickly. People decide what the definition means, staff record the events, and managers decide how to act. A dashboard can make all of that visible. It can also conceal all of it behind a large number.

## A precise answer to the wrong question

There are two different failures to watch for. The records may be wrong, or the measure may be wrong for the decision. More careful arithmetic fixes neither automatically.

Suppose P01 and P02 turn out to be the same person registered twice. The identifiers are different, so the count of three people is overstated. Someone must establish the relationship and correct the records. Matching names alone is not enough: two people can share a name, and one person can use several names or addresses.

Alternatively, suppose all the identifiers are correct but the director wants paying customers. Activity is not proof of payment. The data can be accurate and still fail to answer the question.

A blank field creates another trap. In Figure 6.1, Yes and No have stated meanings. In a real file, a blank might mean no contact, a missing answer or an older system that never collected the information. Turning all blanks into No gives a tidy result by hiding uncertainty.

Follow the number back to the event that created it. Who records activity? Does the system capture mobile use as well as website use? Are cancelled accounts retained? If an employee corrects a record, does the report update? You do not need to inspect every transaction. You need enough understanding to know what the number can support.

Then check the reporting period. A count of people who have ever contacted support will tend to accumulate. A count of people active in the last twelve months can rise or fall. Putting those lines together on a chart does not make them comparable measures of growth.

Consider what happens when the director asks for the count every month. An analyst should not have to settle its meaning again each time. Record the definition beside the report, identify the system supplying it, and assign someone to resolve uncertain cases. Those few decisions turn a one-time calculation into a repeatable information process.

If a new mobile app starts recording activity differently, that process needs attention. The team should check a few known cases, explain any break in comparability and decide whether earlier periods can be recalculated. Otherwise a software release can manufacture apparent customer growth. Keeping the definition visible lets the business distinguish a change in behaviour from a change in what it can observe.

## The measure becomes the target

A number does more than describe work when it determines a bonus, a promotion or a warning from the manager. People start responding to it.

Imagine a support manager rewarding agents for tickets closed. A ticket is the record of a customer's request for help. Closing it is an action in the system; resolving the customer's problem is the desired outcome. Usually the two are related. They are not identical.

An agent can improve the count by solving more problems. The agent might also close a difficult ticket too early, concentrate on easy requests, or encourage the customer to open another ticket later. None of those possibilities requires a broken computer. The computer can record every closure perfectly while the measure becomes less useful.

This is the warning commonly called Goodhart's law: using a measure as a target can change behaviour in ways that weaken its connection to the result you care about. It is a warning about incentives, not a claim that every target must fail.

Figure 6.2 shows a fictional team before and after a greater emphasis on closures. Each period's closed tickets receive the same follow-up window, and reopened tickets are linked to the period in which they were closed.

*Figure 6.2 — The target improved. Did service? More closed tickets can conceal more unresolved work.*

| Period | Tickets closed | Closed tickets reopened |
|---|---:|---:|
| A | 90 | 5 |
| B | 100 | 30 |

*Comparable workload assumed; these measures do not capture every aspect of quality.*

Closures rose from 90 to 100. Reopenings rose from 5 to 30. About 5.6 percent of closed tickets reopened in A, compared with 30 percent in B. The headline target improved while a warning sign about service became much worse.

That does not prove the bonus caused the change. Perhaps a product update created problems that initially appeared solved. Reopening is itself an imperfect measure: a customer may return with a different issue, or give up without reopening anything. The table gives the manager a reason to investigate, not grounds to accuse the team.

Review a sample of reopened cases with the agents. Look at what customers still needed. Then decide whether to change the closure rule, the incentive, the product or the staffing. A second measure helps reveal a problem; conversation and examination of the work help explain it.

Do not respond by adding twenty targets. A small set should make the desired result and important tradeoffs visible. For this team, closures might sit beside repeat contact and the age of unresolved requests. The manager still has to judge whether customers are getting help.

## When the spreadsheet and the experienced manager disagree

Now give that support manager a different problem. In a fictional staffing review, a report shows that evening requests take longer to resolve than daytime requests. An analyst recommends retraining the evening team. Its supervisor objects: evenings handle the difficult cases that other teams transfer before going home.

The report is evidence. So is the supervisor's knowledge of how the work moves. Neither settles the matter as stated.

First ask what “time to resolve” includes. Is it the time an agent actively works, or elapsed time while waiting for a customer or another department? Does a transferred request arrive with its earlier waiting time attached? Are simple password resets being compared with complex billing investigations?

The supervisor's explanation can be checked. Separate comparable types of request and identify transfers. Compare the teams within those groups. If the difference shrinks, case mix explains part of the original result. If it remains, investigate training, access to specialists and other conditions. The finding may point to a scheduling problem rather than weak individual performance.

Here is a small worked version. Assume each team handles ten requests, with no transfers or waiting time. Simple requests take ten minutes of work each and complex requests take forty minutes, for either team. The daytime team receives eight simple requests and two complex ones: 80 plus 80 minutes, or sixteen minutes per request. The evening team receives four simple requests and six complex ones: 40 plus 240 minutes, or twenty-eight minutes per request.

The evening average is substantially higher even though both teams work at exactly the same pace on each type of request. In this simplified example, retraining the evening team addresses a difference that does not exist. The calculation does not establish the explanation for a real workplace; it demonstrates why the manager must examine the mix of work before interpreting the average as employee performance.

Experience earns its place by producing an explanation you can examine. Analysis earns its place by representing the work well enough to test that explanation. “The data says so” and “I have done this for twenty years” are both ways of ending a conversation too early.

Suppose a deadline prevents a full investigation. The manager can postpone a punitive decision, review a small sample and test additional specialist coverage for a limited period. State what improvement would justify continuing it. A decision can be provisional without being arbitrary.

This is the managerial use of analysis: reduce uncertainty enough to choose a sensible action, make the remaining uncertainty explicit, and learn from what happens. More data is useful when it changes that choice. Collecting another month of the wrong measure only delays it.

## Three debts, briefly paid

Earlier chapters have already handed you numbers that deserve this treatment.

A claim that a department became smaller needs a boundary: which employees, in which unit, over what period? A claim that an assistant did the work of a certain number of agents describes estimated workload equivalence; it does not by itself establish how many people lost jobs. You have met both distinctions in the Ford and Klarna discussions. Carry them forward rather than remembering only the impressive number.

Different buyers can also judge the same company's systems differently because they want different things from a purchase. One needs continuity, another needs room to grow, and another needs systems it can readily combine with its own. The underlying facts may be shared while the decision criteria differ. You do not need a simulation to recognise that problem.

Disagreement is therefore a place to start. Ask whether people dispute the records, the definition, the explanation or the objective. Those are four different conversations. An argument about the customer count will go nowhere if one person means billing accounts and another means people the company can reach.

This does not mean every interpretation is equally defensible. Definitions must be applied correctly, evidence must support the explanation, and the measure must suit the decision. Stating an assumption makes it available for challenge; it does not make it true.

## Optional: what a price tells you

There is a useful version of the same lesson in sports odds. Use these fictional prices; no account, live market or wager is needed.

Assume an event has two possible outcomes. One side is quoted at −150, meaning a successful $150 stake earns $100 profit, with the stake also returned. The other is +130, meaning a successful $100 stake earns $130 profit, again with the stake returned.

The first price gives a break-even probability of 150 divided by 250, or 60 percent. The second gives 100 divided by 230, or about 43.48 percent. Add them and you get 103.48 percent.

This total is called the overround; it exceeds 100 percent by 3.48 percentage points. These prices do not directly form probabilities adding to one. It is not a guaranteed 3.48 percent profit on every wager. Actual profit depends on the stakes accepted and the outcome, among other things.

One simple adjustment divides each number by their sum. That gives about 57.98 percent and 42.02 percent. They now add to 100 percent, but the adjustment assumes the pricing excess is removed proportionally. Arithmetic has produced a consistent pair, not discovered the true chances.

Your question is the same as it was for the customer file: what was this number constructed to do? A selling price can contain information about expectations while also reflecting commercial decisions. Converting its format does not remove every assumption behind it.

## Your turn

Return to Figure 6.1. A director asks for one message to each person active in the last twelve months. How many recipients qualify? Explain why counting Yes rows would send the wrong number of messages. Then identify what information is missing before anyone can actually send them.

Next, imagine a new row: P02 / A30 / S104 / Yes / No. Recalculate the counts of people, accounts, subscriptions and active people. Which numbers change? Write the label you would put under each changed number in a board presentation. Do not call them all customers.

Now choose a number your own life is scored by: a GPA, a productivity measure at work or a fitness app's daily target. Write down what it counts, what it leaves out and what you could do to improve the number without improving the result it is supposed to represent. Suggest one way to check whether that is happening.

Finally, take either the reopened-ticket example or the evening-team disagreement. State the decision you face, the evidence you have and the smallest additional check that could change your action. Someone must make a decision before perfect information arrives. Explain yours.

For the evening-team example, explain whether comparing requests of the same type would change your recommendation, and why an overall average could mislead you.

Three questions are worth keeping past this course. What exactly was counted, and what was left out? How was it measured, and by whom? What was it constructed to do, and does that purpose fit this decision?

A number that survives those questions is better understood, not automatically beyond doubt. You know what you are trusting, where its limits are, and what would make you reconsider. That is a much stronger position than being impressed by its precision.

## Sources and example notes

Moneyball provides a business interpretation of measurement and valuation; the chapter does not attribute every sporting outcome to one measure. Customer records, support measures and staffing calculations are fictional. The database explanation is consistent with [Oracle’s database overview](https://www.oracle.com/database/what-is-database/). The odds example explains arithmetic, not a recommendation to wager. The odds terminology and limits of normalisation follow [Hegarty and Whelan’s April 2025 revised draft, pp. 4–6](https://www.karlwhelan.com/Papers/Overround.pdf). This citation refers to the inspected draft, not unverified journal pagination.

