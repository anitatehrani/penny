// The guides on the public pages /guides (docs/DESIGN.md section 45): short, practical, plain-language articles that help by themselves and mention
// Penny only where Penny really does the thing described. They are data, not markup: guidePages.js turns them into pages, escaping everything.
//
// A block is a string (a paragraph) or one of: { ul: [...] }, { ol: [...] }, { example: { title, rows: [[label, value], ...], note } }, { note: '...' }.
// In text, **bold** and [a link](/an/address/on/this/site) work; nothing else does.
// Keep titles to 60 characters and descriptions to 160 or fewer (a test checks), amounts as made-up examples, and no claim that cannot be checked.

export const GUIDES_INDEX = {
  title: 'Budgeting guides in plain words · Penny',
  description: 'Short guides on planning a monthly budget, budgeting as a couple, checking if you can afford something, importing a bank statement and tracking subscriptions.',
  intro: 'Short, practical guides on the money questions people ask most. Each one works on its own, with a pencil and paper or any budget app, and each says how Penny can help where it really can.',
};

export const GUIDES = [
  {
    slug: 'how-to-plan-a-monthly-budget',
    title: 'How to plan a monthly budget in 6 steps',
    description: 'A simple, practical way to plan a monthly budget: know your income, list your bills, give every category an amount, and check in during the month.',
    updated: '2026-10-11',
    intro: 'A monthly budget is a plan for one month: how much money comes in, and how much each kind of spending may use. It does not have to be strict or complicated. Six steps are enough to start, and you can adjust it every month.',
    sections: [
      {
        h: 'Step 1: Write down what comes in',
        blocks: [
          'Start with the money you can count on this month: your salary, benefits and any other regular income. If your income changes from month to month, use the lower amounts of the last few months, so the plan does not depend on a good month.',
          'Leave out money that is only possible, like a bonus you may or may not get. If it arrives, you can decide then what to do with it.',
        ],
      },
      {
        h: 'Step 2: List the bills that do not change',
        blocks: [
          'Rent or mortgage, electricity and gas, internet and phone, insurance, loan payments, subscriptions. Write the amount and the day it leaves your account.',
          'Do not forget the bills that come only once or twice a year, such as insurance, a tax or a holiday. Divide the yearly amount by 12 and set that aside every month, so it is already there when the bill arrives.',
        ],
      },
      {
        h: 'Step 3: Look at what you really spend on everyday things',
        blocks: [
          'Groceries, transport, eating out, clothes, health, fun. Do not guess. Open your bank app or your last two or three statements and add up each kind of spending. Many people find that the real amounts differ from what they imagined.',
          'If you want a faster way, [import a bank statement](/guides/import-a-bank-statement) into a budget app and let it add up the categories for you.',
        ],
      },
      {
        h: 'Step 4: Give every category an amount',
        blocks: [
          'Put the numbers together: income, minus the fixed bills, minus the everyday categories. Whatever is left should have a purpose too: savings, paying off a debt, or a small buffer for surprises. Money with no purpose tends to disappear.',
          {
            example: {
              title: 'An example (the amounts are made up)',
              rows: [
                ['Income', '2,400'],
                ['Rent', '800'],
                ['Electricity, gas and phone', '150'],
                ['Insurance and subscriptions', '90'],
                ['Groceries', '380'],
                ['Transport', '120'],
                ['Eating out and fun', '150'],
                ['Clothes and health', '80'],
                ['Savings', '300'],
                ['A buffer for surprises', '100'],
                ['Not yet planned', '230'],
              ],
              note: 'The amounts after the income add up to the income, so every bit of money has a place.',
            },
          },
          'If the result is below zero, the plan needs a change before the month starts. Pick the categories you can reduce, and be honest about which ones are real needs.',
        ],
      },
      {
        h: 'Step 5: Look at it during the month',
        blocks: [
          'A plan only helps if you compare it with what really happens. Look once a week, or at least in the middle of the month, at how much of each category is already spent.',
          'If groceries are at 70% of their amount on the 12th, you know it early and can slow down, not on the 30th when it is too late. The useful question is: at this pace, where will the month end?',
        ],
      },
      {
        h: 'Step 6: Look back at the end of the month, and adjust',
        blocks: [
          'At the end of the month, see where you stayed inside the plan and where you went over. If a category is over every month, the amount was probably too low, not you too weak. Change the amount, or change the habit, but do it on purpose.',
          'A budget is not a test you pass or fail. It gets more accurate every month, because every month you know a little more.',
        ],
      },
      {
        h: 'Mistakes that make budgets fail',
        blocks: [
          {
            ul: [
              'Leaving out the yearly bills, which then arrive as a shock.',
              'Setting amounts so tight that nobody could keep to them. A realistic plan you follow beats a perfect one you give up.',
              'No buffer at all, so the first surprise ruins the month.',
              'Setting it up once and never looking at it again.',
            ],
          },
        ],
      },
    ],
    penny: {
      h: 'How Penny helps',
      text: 'The Monthly budget page in Penny lets you give every category an amount, and can suggest the amounts from what you usually spend. It shows how much is spent and how much is left, tells you in plain words which categories are heading over, estimates where the month will end, and warns you in the app when a category has used 80% of its amount and again when it goes over. When the month is over, it shows how it went.',
    },
    related: ['can-i-afford-it', 'track-subscriptions-and-recurring-bills'],
  },
  {
    slug: 'budgeting-as-a-couple',
    title: 'Budgeting as a couple: joint, separate or both',
    description: 'Three common ways couples and housemates handle money, how to choose one, and how to keep a shared budget fair and free of arguments.',
    updated: '2026-10-11',
    intro: 'Money is one of the things couples and housemates disagree about most, often because nobody ever agreed on how it works. There is no single right way. Here are the three most common setups, and how to choose between them.',
    sections: [
      {
        h: 'Setup 1: Everything together',
        blocks: [
          'All income goes into one pool, and all bills and spending come out of it. It is simple, you both see the whole picture, and there is nothing to split or settle.',
          'It works best when your incomes are similar and you trust each other with money. The risk is that one of you may feel they have no freedom, so agree on a personal amount that each of you may spend without explaining.',
        ],
      },
      {
        h: 'Setup 2: Shared costs together, the rest separate',
        blocks: [
          'Each of you puts an agreed amount into a shared account or shared budget, which pays for rent, bills, groceries and anything else you decided is shared. What is left of your own income is yours.',
          'This is the compromise many couples end up with. It keeps the shared things clear and leaves each of you in charge of your own money.',
        ],
      },
      {
        h: 'Setup 3: Split every bill',
        blocks: [
          'Each bill or purchase is split between you, and each pays their part. It is very clear who paid what, but it needs the most tracking, and it can feel like keeping score.',
          'The split does not have to be half and half. If one of you earns more, you can split in proportion to income.',
          {
            example: {
              title: 'A split in proportion to income (made-up amounts)',
              rows: [
                ['Rent and shared bills together', '1,200'],
                ['One person earns', '3,000'],
                ['The other earns', '2,000'],
                ['Together they earn', '5,000'],
                ['First person pays 60% (3,000 of 5,000)', '720'],
                ['Second person pays 40% (2,000 of 5,000)', '480'],
              ],
              note: 'Both end up giving the same share of their income to the shared costs.',
            },
          },
        ],
      },
      {
        h: 'How to choose',
        blocks: [
          'Talk about these questions, rather than picking a setup first:',
          {
            ul: [
              'Do your incomes differ a lot? If so, an equal split can be unfair, and a split in proportion to income may feel better.',
              'Do you have goals you save for together, like a home or a trip? A shared pot makes that easier.',
              'How much freedom does each of you want over your own money?',
              'Does one of you handle money more easily than the other? Say it openly, and share the work so it does not fall on one person.',
            ],
          },
          'You can start with one setup and change it. Many couples do, when their life changes.',
        ],
      },
      {
        h: 'What keeps it peaceful',
        blocks: [
          {
            ol: [
              '**Decide what counts as shared.** Rent and groceries, usually yes. Hobbies and gifts to your own family, often no. Write it down.',
              '**Give each person an amount that is theirs.** No questions asked, no explaining.',
              '**Agree on a limit.** Above a certain amount, for example 100, you talk before buying.',
              '**Look at the numbers together once a month.** Fifteen minutes is enough, and it is better to do it when nothing is wrong.',
              '**Both of you can see the same numbers.** Trust is easier when nothing is hidden.',
            ],
          },
          'The same applies to housemates: agree on what is shared, settle up regularly, and write it down.',
        ],
      },
    ],
    penny: {
      h: 'How Penny helps',
      text: 'In Penny you can make a shared budget and invite the people you are connected with. Everyone in it sees what is in it, and nobody sees your personal budget or your other details. You can split a single payment between people and give each their share, and every person keeps their own private budget as well. Anyone can leave a shared budget whenever they like. See also the [monthly budget](/guides/how-to-plan-a-monthly-budget) guide for planning the shared money category by category.',
    },
    related: ['how-to-plan-a-monthly-budget', 'can-i-afford-it'],
  },
  {
    slug: 'can-i-afford-it',
    title: 'Can I afford it? Check your balance months ahead',
    description: 'Before a big purchase, look at more than today\'s balance. Here is how to check whether the money will still be there when the bills come.',
    updated: '2026-10-11',
    intro: 'The balance in your account today does not tell you whether you can afford something. What matters is what is left after the bills that are still on their way. Here is a check that takes about ten minutes.',
    sections: [
      {
        h: 'Why today\'s balance can mislead',
        blocks: [
          'Your account may look healthy today and still run short in three weeks, because the rent, an insurance payment and a credit card bill have not left yet. The reverse is also true: a low balance just before payday is not a problem if the money is certain to arrive.',
          'So the question is not "how much do I have?" but "what will my balance be at the end of each coming month, and what is the lowest it gets?"',
        ],
      },
      {
        h: 'The check, step by step',
        blocks: [
          {
            ol: [
              '**Write down today\'s balance.** Count only the money you are willing to spend, not savings you want to keep.',
              '**List the money still to come in** for each of the next months: salary and any other regular income.',
              '**List what has to go out** each month: rent, bills, loan payments and installments, plus a realistic amount for everyday spending.',
              '**Add the purchase** in the month you would pay for it. If you pay in installments, add each installment in its own month.',
              '**Work out the balance at the end of each month,** by adding what comes in and taking away what goes out.',
              '**Find the lowest point** and compare it with the buffer you want to keep.',
            ],
          },
        ],
      },
      {
        h: 'An example',
        blocks: [
          'Today the balance is 1,800. Each month 2,600 comes in and 2,350 goes out (1,750 in bills and 600 in everyday spending), so 250 is left every month. In the fourth month there is a purchase of 1,500.',
          {
            example: {
              title: 'The balance at the end of each month (made-up amounts)',
              rows: [
                ['Today', '1,800'],
                ['End of month 1', '2,050'],
                ['End of month 2', '2,300'],
                ['End of month 3', '2,550'],
                ['End of month 4, after the purchase of 1,500', '1,300'],
                ['End of month 5', '1,550'],
                ['End of month 6', '1,800'],
              ],
              note: 'The lowest point is 1,300, in month 4.',
            },
          },
          'The balance never goes below zero, so the purchase fits. But the lowest point, 1,300, is less than one month of outgoings (2,350). Many people want at least a month of outgoings as a minimum buffer, and a bigger emergency fund over time. You could decide to wait a few months, or to pay in installments.',
        ],
      },
      {
        h: 'What a buffer is, and how big it should be',
        blocks: [
          'A buffer is an amount you decide not to go below, so that a broken washing machine or a late payment does not become a crisis. How big it should be depends on you: how steady your income is, whether others depend on you, and how much a surprise would cost.',
        ],
      },
      {
        h: 'About installments',
        blocks: [
          'Paying in installments makes the purchase lighter this month, but every installment is a bill in every coming month. Add all of them to your check, and if there is interest, add that too. A purchase that is easy this month can make the next six months tight.',
        ],
      },
      {
        h: 'What people forget',
        blocks: [
          {
            ul: [
              'Bills that come once or twice a year: insurance, taxes, subscriptions that renew yearly.',
              'Birthdays, holidays and gifts, which are not a surprise, only forgotten.',
              'Credit card purchases, which leave your account a month or so after you buy.',
              'Income that arrives late, or that is lower in some months.',
            ],
          },
        ],
      },
    ],
    penny: {
      h: 'How Penny helps',
      text: 'The Forecast page in Penny does these sums for you. From what is pending, what repeats and what is in installments, it shows your balance month by month, up to two years ahead, with an estimate of everyday spending that you can switch off. It warns you before the balance goes below zero or below the safety buffer you choose, and tells you the lowest point. Add the purchase as a payment with its date, and the forecast shows what it does to the months after.',
    },
    related: ['how-to-plan-a-monthly-budget', 'track-subscriptions-and-recurring-bills'],
  },
  {
    slug: 'import-a-bank-statement',
    title: 'How to bring a bank statement into a budget app',
    description: 'Get your payments into a budget app without typing: download a statement from your bank, check the lines, fix the categories and avoid duplicates.',
    updated: '2026-10-11',
    intro: 'Typing every payment by hand is the main reason people give up on a budget. Most banks let you download your payments as a file. Here is how to use one, whichever bank and whichever budget app you have.',
    sections: [
      {
        h: 'Step 1: Download the statement',
        blocks: [
          'Log in to your bank\'s website or app and open the account. Look for words like "statements", "documents", "export" or "download". Where exactly it is differs from bank to bank, so look around the account page, and ask your bank if you cannot find it.',
          'Choose the period you want. Most banks let you pick the dates, or a month at a time.',
        ],
      },
      {
        h: 'Step 2: Pick a format that can be read',
        blocks: [
          {
            ul: [
              '**A spreadsheet or CSV file** is the most exact, because every payment is in its own row with clear columns. Choose it when your bank offers it.',
              '**A PDF made by the bank** is usually fine. It contains text that a program can read.',
              '**A scan or a photo of paper** cannot be read, because it is only a picture. Download the statement again from your bank instead.',
              '**A PDF with a password** can be read once you give the password. It is usually something your bank told you, such as a date of birth.',
            ],
          },
        ],
      },
      {
        h: 'Step 3: Choose a sensible period',
        blocks: [
          'For a first import, the last one to three months is a good start. It is enough to see your usual spending, and not so much that checking it takes an evening.',
          'After that, import a month at a time. Be careful not to import the same days twice, or you will count those payments twice.',
        ],
      },
      {
        h: 'Step 4: Check before you save',
        blocks: [
          'A good budget app shows you the lines before it saves them. Take a minute to look:',
          {
            ul: [
              '**Money in or out.** Payments should be money out, and salary money in. If they look reversed, something was misread.',
              '**The dates.** Is 03/04 the third of April or the fourth of March? A wrong order puts payments in the wrong month.',
              '**The total.** Compare the total of what was read with your bank\'s own figures, or with the balance. If they agree, almost certainly nothing was missed.',
              '**Duplicates.** The same payment twice, or a payment you already entered by hand.',
              '**Transfers between your own accounts.** They are money out of one account and in to another. They are not spending, so they should not count as spending.',
            ],
          },
        ],
      },
      {
        h: 'Step 5: Fix the categories once',
        blocks: [
          'The app will guess a category for each payment. It will get most right (a supermarket is groceries) and some wrong. Correct the wrong ones, and use an app that remembers your corrections, so the same shop is right next time.',
          'One thing to watch for is the credit card. If you import both the purchases made with the card and the payment that settles the card bill, the same money is counted twice. Count it once: keep the purchases and treat the bill payment as paying a debt, or the other way round.',
        ],
      },
      {
        h: 'A word about privacy',
        blocks: [
          'A statement is full of personal details: your name, your account number, where and when you shop. Before you give it to any tool, find out where the file goes. Prefer a tool that reads the file on your own device and does not upload it, and delete the downloaded file when you have finished.',
        ],
      },
    ],
    penny: {
      h: 'How Penny helps',
      text: 'The Import statement button on the Payments page in Penny reads PDF, CSV and Excel files from any bank. It works out the layout of the file itself, suggests a category for each line, spots lines that are already in your payments, and shows you everything before anything is saved. It remembers the categories you correct, and one click undoes a whole import. The file is read on your device and is never uploaded; only the lines you confirm are sent, with account and card numbers taken out. See also the [monthly budget](/guides/how-to-plan-a-monthly-budget) guide for what to do with the categories next.',
    },
    related: ['how-to-plan-a-monthly-budget', 'track-subscriptions-and-recurring-bills'],
  },
  {
    slug: 'track-subscriptions-and-recurring-bills',
    title: 'Find and track your subscriptions and recurring bills',
    description: 'How to find every subscription and repeating bill, what to do with the ones you forgot, and how to keep track so that none of them surprises you.',
    updated: '2026-10-11',
    intro: 'Subscriptions are small, so they are easy to forget: a streaming service, an app, a gym, an insurance paid once a year. Together they can be a surprising part of your month. Here is how to find all of them, and keep track.',
    sections: [
      {
        h: 'Step 1: Look through your statements',
        blocks: [
          'Open the last three months of your bank statements, and twelve months if you can, so that yearly payments show up. Look for the same name coming back, with the same or a similar amount, every week, month or year.',
          'Words that often give them away: "subscription", "membership", "renewal", "annual", "monthly". Payments made through PayPal or an app store hide the real service, so look at those more closely. Your bank may also list your direct debits and standing orders in one place.',
        ],
      },
      {
        h: 'Step 2: Check where else they start',
        blocks: [
          'Subscriptions bought through your phone\'s app store are listed in your phone\'s settings. Your email can help too: search for words like "receipt", "invoice", "renewal" or "trial".',
        ],
      },
      {
        h: 'Step 3: Write each one down with its amount and its date',
        blocks: [
          'For each subscription write the name, the amount, how often it is charged, and the next date. To compare them, turn each one into a monthly amount: a yearly payment divided by 12.',
          {
            example: {
              title: 'A list of subscriptions (made-up amounts)',
              rows: [
                ['Streaming, 12.99 a month', '12.99'],
                ['Music, 10.99 a month', '10.99'],
                ['Gym, 35 a month', '35.00'],
                ['Cloud storage, 29.99 a year (29.99 ÷ 12)', '2.50'],
                ['Insurance, 480 a year (480 ÷ 12)', '40.00'],
                ['In all, each month', '101.48'],
              ],
              note: 'Seeing the total each month is often the moment people decide to cancel one or two.',
            },
          },
        ],
      },
      {
        h: 'Step 4: Ask, for each one: do I still want it?',
        blocks: [
          {
            ul: [
              'Did you use it in the last month?',
              'Could one plan be shared with your family or household?',
              'Is there a cheaper plan, or a pause instead of a cancellation?',
              'If you cancel, when does it end? Cancel before the renewal date, not after.',
            ],
          },
        ],
      },
      {
        h: 'Step 5: Keep the list alive',
        blocks: [
          'Put the renewal dates somewhere you will see them, and look at the whole list every three to six months. New subscriptions appear without anyone deciding to start them.',
        ],
      },
      {
        h: 'Watch out for',
        blocks: [
          {
            ul: [
              'Free trials that turn into paid plans. Note the end date the day you start.',
              'Price increases, which usually come with a short email that is easy to miss.',
              'Yearly renewals, which charge a large amount once a year, with little warning.',
            ],
          },
        ],
      },
    ],
    penny: {
      h: 'How Penny helps',
      text: 'In Penny, recurring payments such as rent, salary and subscriptions repeat by themselves, weekly, monthly or yearly, with an end date if they have one. They appear in the forecast, and the Recurring page says what they come to in a month. When you [import a statement](/guides/import-a-bank-statement), services such as streaming are suggested for the Subscriptions category, and you can ask the assistant "What are my subscriptions?".',
    },
    related: ['how-to-plan-a-monthly-budget', 'import-a-bank-statement'],
  },
];

export const guideBySlug = (slug) => GUIDES.find((g) => g.slug === String(slug ?? '').toLowerCase()) ?? null;
