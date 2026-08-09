import java.util.Base64

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseKeystore = System.getenv("DECISION_INBOX_KEYSTORE")
val releaseStorePassword = System.getenv("DECISION_INBOX_STORE_PASSWORD")
val releaseKeyAlias = System.getenv("DECISION_INBOX_KEY_ALIAS")
val releaseKeyPassword = System.getenv("DECISION_INBOX_KEY_PASSWORD")
val releaseSigningReady = listOf(
    releaseKeystore,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }
val releaseRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}
val dartDefines = (project.findProperty("dart-defines") as String?)
    ?.split(",")
    ?.mapNotNull {
        runCatching {
            String(Base64.getDecoder().decode(it), Charsets.UTF_8)
        }.getOrNull()
    }
    .orEmpty()
val dartDefineValues = dartDefines.mapNotNull { define ->
    val separator = define.indexOf('=')
    if (separator <= 0) null else define.substring(0, separator) to define.substring(separator + 1)
}.toMap()
val requiredFirebaseDefines = listOf(
    "FIREBASE_API_KEY",
    "FIREBASE_APP_ID",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_PROJECT_ID",
)
val firebaseReleaseReady = requiredFirebaseDefines.all { name ->
    !dartDefineValues[name].isNullOrEmpty()
}
if (releaseRequested && !releaseSigningReady) {
    throw GradleException(
        "Release signing requires DECISION_INBOX_KEYSTORE, " +
            "DECISION_INBOX_STORE_PASSWORD, DECISION_INBOX_KEY_ALIAS, and " +
            "DECISION_INBOX_KEY_PASSWORD.",
    )
}
if (releaseRequested && !firebaseReleaseReady) {
    throw GradleException(
        "Release push delivery requires FIREBASE_API_KEY, FIREBASE_APP_ID, " +
            "FIREBASE_MESSAGING_SENDER_ID, and FIREBASE_PROJECT_ID dart defines.",
    )
}

android {
    namespace = "cz.agentis.decision_inbox"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "cz.agentis.decision_inbox"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseKeystore!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
