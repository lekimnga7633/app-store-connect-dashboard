# 📊 app-store-connect-dashboard - Track Apple sales data in one place

[![Download Windows App](https://img.shields.io/badge/Download-Release_Page-blue.svg)](https://github.com/lekimnga7633/app-store-connect-dashboard/releases)

This application provides a simple way to view your Apple App Store sales data. It gathers your reports for downloads, purchases, and revenue. You see your business performance across all your iOS and macOS apps in a single window. It runs on your own computer to keep your data private.

## 🚀 Getting Started

Follow these steps to set up the dashboard on your Windows computer.

1. Visit the [releases page](https://github.com/lekimnga7633/app-store-connect-dashboard/releases) to download the installer.
2. Choose the file ending in `.exe` for Windows.
3. Save the file to your computer.
4. Open the file to start the installation.
5. Follow the instructions on the screen.

## 🏗️ Requirements

Your computer needs to meet these basic standards to run the software smoothly:

- Windows 10 or Windows 11.
- A stable internet connection to fetch the latest reports.
- Access to your App Store Connect API credentials.

## 🔑 How to Setup Apple Credentials

The dashboard connects to Apple servers to get your data. You provide your credentials to the app so it can pull the reports.

1. Log in to your App Store Connect account.
2. Go to the Users and Access section.
3. Select the Integrations tab.
4. Click the Keys tab.
5. Create a new App Store Connect API key.
6. Copy the Issuer ID and the Key ID.
7. Download the private key file.
8. Open the dashboard app.
9. Enter your Issuer ID, Key ID, and upload the private key file in the settings menu.

The dashboard uses this connection to fetch your data automatically. It does not send your data to any third-party servers. Everything stays on your machine.

## 📈 Understanding the Dashboard

Once you finish the setup, the dashboard fetches your reports. This process takes a few minutes if you have a lot of data. You will see several sections on your screen.

### Revenue Summary
This area shows the money you earn. You can filter by date range to see a daily, weekly, or monthly view.

### Download Totals
This section tracks how many people download your apps. It breaks down the numbers by app name and territory.

### Purchase Breakdown
This tracks in-app purchases and full app sales. You can identify which apps drive your revenue.

## 🛠️ Managing Your Data

The dashboard saves your data in a local database. You can clear this data at any time through the settings menu. This keeps your disk usage low.

If you have many apps, you might prefer to see specific data. Use the filter bar at the top of the app to show only the apps you want to see. You can also hide inactive apps from the main list.

## 💡 Frequent Questions

Do I need to pay for this app?
No. This tool is free to use.

Where does my data go?
Your data stays on your computer. The app connects directly to Apple's servers and saves the files locally. No external company sees your sales figures.

How do I update the dashboard?
When a new version comes out, return to the [releases page](https://github.com/lekimnga7633/app-store-connect-dashboard/releases) to download the latest installer. Installing the new version will replace the old one while keeping your data settings intact.

What do I do if the app fails to fetch data?
Check your internet connection first. If that fails, ensure your API keys in the settings menu are correct. API keys can expire, so you may need to generate a new file if you changed your account permissions.

Can I view my data offline?
Yes. Once the dashboard downloads your reports, you can look at them even if you turn off your Wi-Fi. You only need the internet to fetch new reports from Apple.

Is this tracker secure?
The app uses industry-standard encryption for the connection to Apple. Since the app is self-hosted, you hold the keys to your own information. Do not share your private key file with others, as it allows access to your App Store Connect account.

## 📋 Best Practices

- Review your numbers once every day.
- Back up your local data folder if you store years of reports.
- Use the search bar to find specific products quickly.
- Keep your Windows operating system current to ensure compatibility.

This dashboard helps you make informed choices about your app business. By looking at clear trends, you see which features your customers value most. You can change your roadmap based on real, local numbers instead of guesswork.